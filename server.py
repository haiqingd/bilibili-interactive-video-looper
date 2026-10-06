#!/usr/bin/env python3
"""Run with Python 3.11+: python3 server.py. Core parser uses the standard library; ending OCR is optional."""
import argparse
import json
import mimetypes
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from looper.bilibili import collect, author_videos, BilibiliError, Client
from looper.demo import demo_graph
from looper.engine import analyze
from looper.storage import Store

from looper.ending_ocr import recognize, available
from looper.ending_pipeline import identify_endings

ROOT = Path(__file__).resolve().parent


def create_server(host="127.0.0.1", port=8765, db_path=None, public_origins=None):
    store = Store(db_path or os.environ.get("LOOPER_DB", ROOT / "data" / "guides.sqlite3"))
    allowed_origins = set()
    for value in (public_origins if public_origins is not None else os.environ.get("LOOPER_PUBLIC_ORIGINS", "").split(",")):
        value = value.strip()
        if not value: continue
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("LOOPER_PUBLIC_ORIGINS 须为完整来源，例如 https://story-explorer.nas.haiqingd.top:1443")
        allowed_origins.add(value)
    jobs, lock, gate = {}, threading.Lock(), threading.Semaphore(1)

    def worker(key, value, cookie):
        try:
            def progress(phase, done, discovered):
                with lock: jobs[key].update(phase=phase, done=done, discovered=discovered, phase_kind="endings" if phase.startswith("自动识别结局") else "graph")
            graph = collect(value, cookie, progress, lambda: jobs[key]["cancelled"])
            progress("计算条件路线与循环", len(graph["nodes"]), len(graph["nodes"]))
            graph["analysis"] = analyze(graph)
            guide_id = store.save(graph)
            with lock: jobs[key].update(guide_id=guide_id)
            if graph.get("graph_complete", True) and not jobs[key]["cancelled"]:
                summary = identify_endings(store, guide_id, evidence_dir, cookie, progress,
                    lambda: jobs[key]["cancelled"], recognizer=recognize, supported=available())
            else:
                saved = store.get(guide_id)["graph"]
                named = sum(bool(a.get("name")) for a in saved["ending_annotations"].values())
                summary = {"status": "pending", "named": named, "total": len(saved["ending_annotations"]),
                    "groups": len(saved["ending_groups"]), "warnings": ["流程采集已中断，暂未继续读取片尾；已有结果已保存。"]}
                store.set_ending_recognition(guide_id, summary)
            with lock: jobs[key].update(status="done", guide_id=guide_id, phase="流程与结局名称已保存", ending_recognition=summary)
        except (ValueError, KeyError, TypeError, OSError):
            import sys
            exc = sys.exception()
            message = str(exc) if isinstance(exc, BilibiliError) else "解析失败：上游数据格式不兼容或本地存储不可用。"
            with lock: jobs[key].update(status="error", error=message)
        finally:
            cookie = ""  # Never persisted, returned, or logged.
            gate.release()

    evidence_dir = Path(store.path).parent / "ending-evidence"

    def ending_worker(key, guide, nodes, cookie, force=False):
        try:
            def progress(phase, done, discovered):
                with lock: jobs[key].update(phase=phase, done=done, discovered=discovered)
            summary = identify_endings(store, guide["id"], evidence_dir, cookie, progress,
                lambda: jobs[key]["cancelled"], recognizer=recognize, supported=available(), nodes=nodes, force=force)
            with lock: jobs[key].update(status="error" if any(x in str(summary["warnings"]) for x in ("412", "429", "-352")) else "done",
                guide_id=guide["id"], recognized=summary["named"], ending_recognition=summary,
                error="；".join(summary["warnings"]), phase="结局名称已保存")
        except Exception as exc:
            with lock: jobs[key].update(status="error", guide_id=guide["id"],
                error=str(exc) if isinstance(exc, BilibiliError) else "片尾识别失败，已完成的结果已保存。")
        finally:
            cookie = ""; gate.release()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass

        def send(self, status, payload, mime="application/json; charset=utf-8"):
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode() if mime.startswith("application/json") else payload
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.hdslb.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers(); self.wfile.write(raw)

        def trusted(self):
            host_header = self.headers.get("Host", "")
            local_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            expected = local_hosts | {urlparse(origin).netloc for origin in allowed_origins}
            if host_header not in expected:
                self.send(403, {"error": "访问域名未配置"}); return False
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + h for h in local_hosts} | allowed_origins:
                self.send(403, {"error": "拒绝跨站请求"}); return False
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.send(403, {"error": "拒绝跨站请求"}); return False
            return True

        def body(self):
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("请求须为 application/json")
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 16 * 1024 * 1024: raise ValueError("请求体大小无效（最大 16 MB）")
            def reject_constant(_): raise ValueError("JSON 不允许 NaN 或 Infinity")
            body = json.loads(self.rfile.read(size), parse_constant=reject_constant)
            if not isinstance(body, dict): raise ValueError("请求体必须为 JSON 对象")
            return body

        def do_GET(self):
            if not self.trusted(): return
            path = urlparse(self.path).path
            if path == "/api/ending-capabilities": return self.send(200, {"ocr": available()})
            if path.startswith("/api/guides/") and path.endswith("/ending-evidence"):
                result = store.get(path.split("/")[-2])
                params = parse_qs(urlparse(self.path).query)
                try:
                    annotation = result["graph"]["ending_annotations"][params["node"][0]]
                    index = int(params.get("frame", ["0"])[0])
                    if not 0 <= index < len(annotation["frames"]): raise ValueError()
                    import re
                    filename = annotation["frames"][index]["file"]
                    if not re.fullmatch(r"[0-9a-f]{32}\.jpg", filename): raise ValueError()
                    return self.send(200, (evidence_dir / filename).read_bytes(), "image/jpeg")
                except (TypeError, KeyError, ValueError, OSError): return self.send(404, {"error": "截图不存在"})
            if path == "/api/guides": return self.send(200, store.list())
            if path == "/api/authors": return self.send(200, store.authors())
            if path.startswith("/api/authors/") and path.endswith("/videos"):
                mid = path.split("/")[-2]
                if not any(a["id"] == mid for a in store.authors()): return self.send(404, {"error": "请先解析这个 UP 主的一个视频。"})
                return self.send(200, store.author_catalog(mid))
            if path.startswith("/api/guides/"):
                result = store.get(path.split("/")[-1])
                return self.send(200 if result else 404, result or {"error": "攻略不存在"})
            if path.startswith("/api/jobs/"):
                with lock: result = dict(jobs.get(path.split("/")[-1], {}))
                return self.send(200 if result else 404, result or {"error": "任务不存在"})
            assets = {"/": "index.html", "/app.js": "app.js", "/theme.js": "theme.js", "/endings.js": "endings.js", "/map.js": "map.js", "/compare.js": "compare.js", "/style.css": "style.css", "/favicon.svg": "favicon.svg"}
            if path not in assets: return self.send(404, {"error": "页面不存在"})
            file = ROOT / "static" / assets[path]
            return self.send(200, file.read_bytes(), (mimetypes.guess_type(file)[0] or "text/plain") + "; charset=utf-8")

        def do_POST(self):
            if not self.trusted(): return
            try:
                body = self.body()
                path = urlparse(self.path).path
                if path.startswith("/api/guides/") and path.endswith("/ending-annotation"):
                    key = path.split("/")[-2]; guide = store.get(key); node_id = str(body.get("node_id", ""))
                    prior = guide["graph"]["ending_annotations"].get(node_id) if guide else None
                    if not prior: raise ValueError("结局不存在")
                    name = body.get("name")
                    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120: raise ValueError("结局名称须为 1–120 字")
                    result = store.set_ending_annotation(key, node_id, {**prior, "name": name.strip(),
                        "category": body.get("category") or None, "source": "manual", "status": "recognized",
                        "needs_review": False, "reason": "人工核对保存"})
                    return self.send(200, result)
                if path.startswith("/api/guides/") and path.endswith("/recognize-endings"):
                    guide = store.get(path.split("/")[-2])
                    if not guide: return self.send(404, {"error": "攻略不存在"})
                    if not available(): raise ValueError("当前环境缺少片尾识别组件，请使用更新后的 Docker 镜像")
                    from looper.bilibili import video_id
                    video_id(guide["graph"]["metadata"].get("bvid", ""))
                    selected_id = body.get("node_id")
                    nodes = [n for n in guide["graph"]["nodes"] if n["leaf"] and n.get("cid") and (
                        str(n["id"]) == str(selected_id) if selected_id is not None else
                        guide["graph"]["ending_annotations"].get(str(n["id"]), {}).get("status") != "recognized")]
                    if not nodes: raise ValueError("没有待识别的结局；已识别结果可在结局详情中重新识别")
                    Client(body.get("cookie", ""))  # Validate before reserving the worker.
                    if not gate.acquire(blocking=False): return self.send(409, {"error": "已有网络读取任务，请等待完成"})
                    key = uuid.uuid4().hex
                    with lock:
                        for old in list(jobs):
                            if jobs[old]["status"] != "running" and time.time() - jobs[old]["created_at"] > 3600: jobs.pop(old)
                        jobs[key] = {"id": key, "status": "running", "phase": "准备片尾识别", "done": 0,
                            "discovered": len(nodes), "recognized": 0, "cancelled": False, "created_at": time.time()}
                    threading.Thread(target=ending_worker, args=(key, guide, nodes, body.get("cookie", ""), selected_id is not None), daemon=True).start()
                    return self.send(202, {"job_id": key})
                if path.startswith("/api/authors/") and path.endswith("/videos"):
                    mid = path.split("/")[-2]
                    if not any(a["id"] == mid for a in store.authors()): return self.send(404, {"error": "请先解析这个 UP 主的一个视频。"})
                    if not gate.acquire(blocking=False): return self.send(409, {"error": "已有网络读取任务，请等待完成。"})
                    try:
                        page = body.get("page", 1)
                        if body.get("refresh") and page != 1: raise ValueError("刷新从第一页开始。")
                        result = author_videos(mid, page, body.get("cookie", ""))
                        if body.get("refresh"):
                            with store.connect() as db: db.execute("DELETE FROM author_pages WHERE author_id=?", (mid,))
                        store.save_author_page(mid, page, result)
                        return self.send(200, store.author_catalog(mid))
                    except (BilibiliError, KeyError, TypeError) as exc:
                        return self.send(502, {"error": str(exc) if isinstance(exc, BilibiliError) else "UP 主投稿接口响应格式已变更。已保存的作品仍可打开。"})
                    finally: gate.release()
                if path == "/api/parse":
                    from looper.bilibili import video_id
                    video_id(body.get("url", ""))
                    if not gate.acquire(blocking=False): return self.send(409, {"error": "已有解析任务运行，请等待完成。"})
                    key = uuid.uuid4().hex
                    with lock:
                        # Bounded in-memory status retention.
                        for old in list(jobs):
                            if jobs[old]["status"] != "running" and time.time() - jobs[old]["created_at"] > 3600: jobs.pop(old)
                        jobs[key] = {"id": key, "status": "running", "phase": "准备解析", "done": 0,
                                     "discovered": 1, "cancelled": False, "created_at": time.time()}
                    threading.Thread(target=worker, args=(key, body["url"], body.get("cookie", "")), daemon=True).start()
                    return self.send(202, {"job_id": key})
                if path == "/api/demo" or path == "/api/import":
                    graph = demo_graph() if path == "/api/demo" else body.get("graph")
                    graph["analysis"] = analyze(graph)
                    return self.send(201, {"guide_id": store.save(graph)})
                if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                    key = path.split("/")[-2]
                    with lock:
                        if key not in jobs: return self.send(404, {"error": "任务不存在"})
                        jobs[key]["cancelled"] = True
                    return self.send(200, {"ok": True})
                return self.send(404, {"error": "接口不存在"})
            except (ValueError, TypeError, KeyError, AttributeError, RecursionError) as exc:
                return self.send(400, {"error": str(exc) if isinstance(exc, ValueError) else "流程 JSON 结构无效"})

        def do_PATCH(self):
            if not self.trusted(): return
            try:
                body = self.body()
                if not urlparse(self.path).path.startswith("/api/guides/"): return self.send(404, {"error": "接口不存在"})
                result = store.update(urlparse(self.path).path.split("/")[-1], body.get("favorite"), body.get("tags"))
                return self.send(200 if result else 404, result or {"error": "攻略不存在"})
            except (ValueError, TypeError): return self.send(400, {"error": "分类参数无效"})

        def do_DELETE(self):
            if not self.trusted(): return
            path = urlparse(self.path).path
            if not path.startswith("/api/guides/"): return self.send(404, {"error": "接口不存在"})
            deleted = store.delete(path.split("/")[-1])
            return self.send(200 if deleted else 404, {"ok": deleted})

    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bilibili 互动视频解析器")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    server = create_server(host=args.host, port=args.port)
    print(f"分岔 · 互动视频解析器已启动：http://127.0.0.1:{server.server_port}", flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
