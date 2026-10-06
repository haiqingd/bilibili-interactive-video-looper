"""Small read-only Bilibili API adapter, independent of third-party SDKs."""
import json
import hashlib
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from .engine import normalize_edge
from .endings import title_annotation


class BilibiliError(ValueError):
    pass


def video_id(value):
    text = str(value).strip()
    if re.fullmatch(r"BV[A-Za-z0-9]{10}", text): return {"bvid": text}
    if re.fullmatch(r"av[0-9]+", text, re.I): return {"aid": int(text[2:])}
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme not in ("https", "http") or parsed.hostname not in ("www.bilibili.com", "bilibili.com", "m.bilibili.com"):
        raise BilibiliError("请输入 bilibili.com 视频链接、BV 号或 av 号（暂不支持短链接）。")
    match = re.match(r"/video/(BV[A-Za-z0-9]{10}|av[0-9]+)(?:/|$)", parsed.path)
    if not match: raise BilibiliError("链接中未找到有效视频编号。")
    return video_id(match.group(1))


class Client:
    def __init__(self, cookie=""):
        self.cookie = cookie or os.environ.get("BILIBILI_COOKIE", "")
        if len(self.cookie) > 16000 or "\n" in self.cookie or "\r" in self.cookie:
            raise BilibiliError("Cookie 格式无效。")
        self.last_request = 0
        self.wbi_keys = None

    def get(self, path, params):
        # Fixed upstream host prevents user-controlled SSRF.
        url = "https://api.bilibili.com" + path + "?" + urllib.parse.urlencode(params)
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/", "Accept": "application/json"}
        if self.cookie: headers["Cookie"] = self.cookie
        delay = max(0, .35 - (time.monotonic() - self.last_request))
        if delay: time.sleep(delay)
        self.last_request = time.monotonic()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024: raise BilibiliError("上游响应过大。")
                result = json.loads(raw)
        except urllib.error.HTTPError as exc:
            if exc.code in (412, 429):
                raise BilibiliError(f"Bilibili 返回 HTTP {exc.code}（访问风控/限流）。请稍后重试，或在本机使用自己的登录 Cookie；也可导入已保存的流程。") from exc
            raise BilibiliError(f"Bilibili HTTP 错误：{exc.code}。") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise BilibiliError("无法读取 Bilibili 接口，请检查网络后重试。") from exc
        # The public nav endpoint returns signing keys even when logged out.
        if path == "/x/web-interface/nav" and result.get("code") == -101 and isinstance(result.get("data"), dict) and result["data"].get("wbi_img"):
            return result["data"]
        if result.get("code") != 0:
            code = result.get("code")
            messages = {-101: "需要登录 Cookie", -404: "视频不存在或不可访问", 99003: "剧情图版本已失效，请重新解析", -352: "访问受到风控限制"}
            # Do not expose untrusted upstream messages or request headers.
            raise BilibiliError(f"Bilibili 接口错误 {code}：{messages.get(code, '请求未成功，可能需要登录或接口已变更')}。")
        data = result.get("data")
        if not isinstance(data, dict): raise BilibiliError("Bilibili 接口响应格式已变更。")
        return data

    def get_signed(self, path, params):
        if self.wbi_keys is None:
            data = self.get("/x/web-interface/nav", {})
            images = data.get("wbi_img", {})
            self.wbi_keys = tuple(urllib.parse.urlparse(images[key]).path.rsplit("/", 1)[-1].split(".")[0]
                                  for key in ("img_url", "sub_url"))
        return self.get(path, sign_wbi(params, *self.wbi_keys))


def sign_wbi(params, image_key, sub_key, timestamp=None):
    """Implement the documented request signature (not a risk-control bypass)."""
    order = (46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,
             12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52)
    combined = image_key + sub_key
    if len(combined) != 64: raise BilibiliError("投稿接口签名信息格式已变更。")
    mixin = "".join(combined[i] for i in order)[:32]
    signed = {**params, "wts": int(time.time()) if timestamp is None else timestamp}
    signed = {key: re.sub(r"[!'()*]", "", str(value)) for key, value in sorted(signed.items())}
    signed["w_rid"] = hashlib.md5((urllib.parse.urlencode(signed) + mixin).encode()).hexdigest()
    return signed


def author_videos(author_id, page=1, cookie="", client=None):
    """Read one page of submissions, filter by the actual interaction flag."""
    if not re.fullmatch(r"[1-9][0-9]{0,18}", str(author_id)):
        raise BilibiliError("UP 主 UID 无效。")
    if type(page) is not int or not 1 <= page <= 1000:
        raise BilibiliError("投稿页码须为 1–1000。")
    client = client or Client(cookie)
    data = client.get_signed("/x/space/wbi/arc/search", {
        "mid": str(author_id), "pn": page, "ps": 30, "order": "pubdate", "tid": 0,
        "keyword": "", "platform": "web", "web_location": "1550101"})
    if data.get("is_risk") or data.get("gaia_res_type"):
        raise BilibiliError("UP 主投稿列表触发了 Bilibili 验证，未将此响应当成空列表。请稍后重试或使用自己的登录 Cookie。")
    listing, pagination = data.get("list", {}), data.get("page", {})
    entries = listing.get("vlist")
    if not isinstance(entries, list): raise BilibiliError("投稿列表格式已变更。")
    videos, unclassified = [], 0
    for video in entries:
        flag = video.get("is_steins_gate")
        if flag is None: unclassified += 1; continue
        if flag not in (1, "1", True): continue
        bvid = video.get("bvid", "")
        if not re.fullmatch(r"BV[A-Za-z0-9]{10}", bvid): continue
        cover = str(video.get("pic", ""))
        if cover.startswith("//"): cover = "https:" + cover
        if cover.startswith("http:"): cover = "https:" + cover[5:]
        hostname = urllib.parse.urlparse(cover).hostname or ""
        if not hostname.endswith(".hdslb.com"): cover = ""
        videos.append({"bvid": bvid, "title": str(video.get("title", bvid)),
            "author": str(video.get("author", "")), "author_id": str(author_id),
            "published_at": video.get("created"), "cover": cover, "duration": video.get("length", ""),
            "play": video.get("play"), "interactive": True})
    total = int(pagination.get("count", 0))
    scanned = min(page * 30, total) if total else (page - 1) * 30 + len(entries)
    return {"author_id": str(author_id), "page": page, "total_submissions": total,
        "scanned": scanned, "has_more": page * 30 < total if total else len(entries) == 30,
        "videos": videos, "unclassified": unclassified,
        "warnings": [f"本页 {unclassified} 个投稿缺少互动标记，未猜测它们是否为互动视频。"] if unclassified else []}


def collect(value, cookie="", progress=lambda *args: None, cancelled=lambda: False, max_nodes=1500, client=None):
    client = client or Client(cookie)
    progress("读取视频信息", 0, 1)
    info = client.get("/x/web-interface/view", video_id(value))
    bvid, cid = info["bvid"], info.get("cid") or info["pages"][0]["cid"]
    player = client.get("/x/player/v2", {"bvid": bvid, "cid": cid})
    version = player.get("interaction", {}).get("graph_version")
    if not version: raise BilibiliError("未获取到互动剧情图。该视频可能不是互动视频，或当前登录状态无权读取。")
    base = {"bvid": bvid, "graph_version": version, "platform": "pc", "portal": 0, "screen": 0, "choices": ""}
    if cancelled(): raise BilibiliError("解析已取消。")
    root_data = client.get("/x/stein/edgeinfo_v2", base)
    root = normalize_edge(root_data, cid)
    nodes = {root["id"]: root}; queue = deque(); queued = {root["id"]}; warnings = []
    raw_edges = {root["id"]: root_data}
    ending_annotations = {root["id"]: title_annotation(root["title"])} if root["leaf"] else {}

    def enqueue(node):
        for q in node["questions"]:
            for choice in q["choices"]:
                target = choice.get("target")
                if target and target not in queued:
                    queued.add(target); queue.append((target, choice.get("cid")))
    enqueue(root)
    interrupted = False
    while queue:
        if cancelled(): interrupted = True; warnings.append("用户取消采集，已保存已读取的部分流程。"); break
        if len(nodes) >= max_nodes:
            interrupted = True; warnings.append(f"达到 {max_nodes} 个节点的采集上限。"); break
        target, target_cid = queue.popleft()
        progress("遍历剧情片段", len(nodes), len(queued))
        try:
            data = client.get("/x/stein/edgeinfo_v2", {**base, "edge_id": target})
            node = normalize_edge(data, target_cid)
            if node["id"] != target: raise BilibiliError("上游返回了不一致的节点编号。")
            raw_edges[target] = data; nodes[target] = node; enqueue(node)
            if node["leaf"]: ending_annotations[target] = title_annotation(node["title"])
        except (BilibiliError, KeyError, TypeError):
            nodes[target] = {"id": target, "title": f"未读取片段 {target}", "cid": target_cid,
                             "leaf": False, "questions": [], "missing": True}
            warnings.append(f"片段 {target} 读取失败，剧情图不完整。")
            # Stop on the first upstream failure, rather than repeatedly hitting a rate limit.
            interrupted = True; break
    for target, target_cid in queue:
        nodes[target] = {"id": target, "title": f"未读取片段 {target}", "cid": target_cid,
                         "leaf": False, "questions": [], "missing": True}
    variables = [{"id": v.get("id_v2") or v["id"], "name": v.get("name", v.get("id_v2", "变量")),
                  "value": v["value"], "random": v.get("type") == 2, "show": bool(v.get("is_show"))}
                 for v in root_data.get("hidden_vars", [])]
    # Keep later variable declarations for inspection; don't silently reset accumulated scores.
    declared = {v["id"] for v in variables}
    for raw in raw_edges.values():
        for v in raw.get("hidden_vars", []):
            key = v.get("id_v2") or v.get("id")
            if key not in declared:
                warnings.append(f"片段中途新增变量 {key}，初始状态未知，相关攻略待验证。")
                declared.add(key)
    return {"schema_version": 1, "metadata": {"bvid": bvid, "aid": info.get("aid"),
            "title": info["title"], "author": info.get("owner", {}).get("name", "未知 UP 主"),
            "author_id": info.get("owner", {}).get("mid"), "published_at": info.get("pubdate"),
            "graph_version": version, "source": "bilibili"}, "root": root["id"],
            "nodes": list(nodes.values()), "variables": variables, "raw_edges": raw_edges,
            "ending_annotations": ending_annotations,
            "graph_complete": not interrupted and all(not n["missing"] for n in nodes.values()), "warnings": warnings}
