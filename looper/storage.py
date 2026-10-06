import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from .endings import title_annotation, CATEGORIES, group_endings


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS guides (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
                bvid TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                favorite INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', graph TEXT NOT NULL,
                UNIQUE(bvid, version, source))""")
            db.execute("""CREATE TABLE IF NOT EXISTS author_pages (
                author_id TEXT NOT NULL, page INTEGER NOT NULL, fetched_at TEXT NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(author_id,page))""")

            db.execute("""CREATE TABLE IF NOT EXISTS ending_annotations (
                guide_id TEXT NOT NULL, node_id TEXT NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(guide_id,node_id))""")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def save(self, graph):
        annotations = graph.get("ending_annotations", {})
        leaves = {str(n["id"]) for n in graph["nodes"] if n["leaf"]}
        if not isinstance(annotations, dict) or any(str(k) not in leaves or not isinstance(v, dict) or v.get("category") not in CATEGORIES | {None} for k, v in annotations.items()):
            raise ValueError("导入的结局标注无效")
        meta = graph["metadata"]
        now = datetime.now(timezone.utc).isoformat()
        source = str(meta.get("source", "import"))
        bvid = str(meta.get("bvid") or uuid.uuid4())
        version = str(meta.get("graph_version", "unknown"))
        with self.connect() as db:
            existing = db.execute("SELECT id FROM guides WHERE bvid=? AND version=? AND source=?", (bvid, version, source)).fetchone()
            key = existing["id"] if existing else uuid.uuid4().hex
            db.execute("""INSERT INTO guides(id,title,author,bvid,version,source,created_at,updated_at,graph)
                VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,author=excluded.author,updated_at=excluded.updated_at,graph=excluded.graph""",
                (key, str(meta.get("title", "未命名流程")), str(meta.get("author", "未知 UP 主")), bvid, version, source,
                 now, now, json.dumps({k: v for k, v in graph.items() if k not in {"ending_annotations", "ending_groups"}}, ensure_ascii=False, allow_nan=False)))
        for node_id, annotation in annotations.items():
            if annotation.get("source") == "title": continue
            if not annotation.get("name") and not annotation.get("category") and annotation.get("source") != "ocr": continue
            # Imported screenshots refer to another installation; never trust their paths.
            imported = {**annotation, "frames": [], "source": "import", "needs_review": True}
            self.set_ending_annotation(key, node_id, imported, overwrite=False)
        return key

    def list(self):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM guides ORDER BY updated_at DESC").fetchall()
        output = []
        for row in rows:
            item = dict(row); graph = json.loads(item.pop("graph"))
            item["tags"] = json.loads(item["tags"]); item["favorite"] = bool(item["favorite"])
            item["nodes"] = len(graph["nodes"])
            self.decorate_endings(item["id"], graph)
            item["ending_nodes"] = sum(n["leaf"] for n in graph["nodes"])
            item["endings"] = len(graph["ending_groups"])
            item["complete"] = graph["analysis"]["complete"]
            item["published_at"] = graph["metadata"].get("published_at")
            item["author_id"] = graph["metadata"].get("author_id")
            output.append(item)
        return output

    def get(self, key):
        with self.connect() as db: row = db.execute("SELECT * FROM guides WHERE id=?", (key,)).fetchone()
        if not row: return None
        graph = json.loads(row["graph"])
        self.decorate_endings(key, graph)
        return {"id": row["id"], "graph": graph, "favorite": bool(row["favorite"]),
                "tags": json.loads(row["tags"]), "updated_at": row["updated_at"]}

    def decorate_endings(self, key, graph):
        graph["ending_annotations"] = {str(n["id"]): title_annotation(n["title"]) for n in graph["nodes"] if n["leaf"]}
        with self.connect() as db:
            annotations = db.execute("SELECT node_id,payload FROM ending_annotations WHERE guide_id=?", (key,)).fetchall()
        nodes = {str(n["id"]): n for n in graph["nodes"]}
        for item in annotations:
            data = json.loads(item["payload"])
            if item["node_id"] in graph["ending_annotations"] and data.get("cid") == nodes[item["node_id"]].get("cid"):
                graph["ending_annotations"][item["node_id"]] = data
        graph["ending_groups"] = group_endings(graph)
        if graph.get("ending_recognition"):
            summary = dict(graph["ending_recognition"])
            summary.update(named=sum(bool(a.get("name")) for a in graph["ending_annotations"].values()),
                           total=len(graph["ending_annotations"]), groups=len(graph["ending_groups"]))
            import re
            summary["warnings"] = [w for w in summary.get("warnings", []) if not re.match(r"^\d+ 个结局节点尚未识别名称", w)]
            missing = summary["total"] - summary["named"]
            if missing:
                summary["warnings"].append(f"{missing} 个结局节点尚未识别名称，暂时独立展示。")
                if summary["status"] == "complete": summary["status"] = "partial"
            graph["ending_recognition"] = summary
        return graph

    def set_ending_recognition(self, key, summary):
        # Keep recognition status separate from the graph's reachability proof.
        with self.connect() as db:
            row = db.execute("SELECT graph FROM guides WHERE id=?", (key,)).fetchone()
            if not row: return
            graph = json.loads(row["graph"]); graph["ending_recognition"] = summary
            db.execute("UPDATE guides SET graph=? WHERE id=?", (json.dumps(graph, ensure_ascii=False, allow_nan=False), key))

    def set_ending_annotation(self, key, node_id, annotation, overwrite=True, protect_manual=False):
        guide = self.get(key)
        node = next((n for n in guide["graph"]["nodes"] if str(n["id"]) == str(node_id) and n["leaf"]), None) if guide else None
        if not node: raise ValueError("结局不存在")
        if annotation.get("category") not in CATEGORIES | {None}: raise ValueError("结局分类无效")
        data = {k: annotation.get(k) for k in ("name", "category", "source", "status", "needs_review", "text", "reason")}
        data["name"] = str(data["name"])[:120] if data["name"] else None
        data["text"] = str(data["text"] or "")[:4000]; data["reason"] = str(data["reason"] or "")[:200]
        data["cid"] = node.get("cid")
        import re
        data["frames"] = [{"file": f["file"], "time": float(f["time"]), "text": str(f.get("text", ""))[:4000],
                           "confidence": float(f.get("confidence", 0))} for f in annotation.get("frames", [])[:3]
                          if re.fullmatch(r"[0-9a-f]{32}\.jpg", str(f.get("file", "")))]
        with self.connect() as db:
            existing = db.execute("SELECT payload FROM ending_annotations WHERE guide_id=? AND node_id=?", (key, str(node_id))).fetchone()
            prior = json.loads(existing["payload"]) if existing else {}
            if protect_manual and prior.get("source") == "manual":
                data.update({k: prior.get(k) for k in ("name", "category", "source", "status", "needs_review", "reason")})
            verb = "REPLACE" if overwrite else "IGNORE"
            db.execute(f"INSERT OR {verb} INTO ending_annotations VALUES (?,?,?)",
                       (key, str(node_id), json.dumps(data, ensure_ascii=False, allow_nan=False)))
        return data

    def update(self, key, favorite=None, tags=None):
        with self.connect() as db:
            if favorite is not None: db.execute("UPDATE guides SET favorite=? WHERE id=?", (int(bool(favorite)), key))
            if tags is not None:
                if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(t, str) or len(t) > 40 for t in tags):
                    raise ValueError("分类标签最多 20 个，每个不超过 40 字")
                db.execute("UPDATE guides SET tags=? WHERE id=?", (json.dumps(tags, ensure_ascii=False), key))
        return self.get(key)

    def delete(self, key):
        with self.connect() as db:
            db.execute("DELETE FROM ending_annotations WHERE guide_id=?", (key,))
            return bool(db.execute("DELETE FROM guides WHERE id=?", (key,)).rowcount)

    def authors(self):
        authors = {}
        for guide in self.list():
            mid = str(guide.get("author_id") or "")
            if not mid.isdigit() or int(mid) <= 0: continue
            author = authors.setdefault(mid, {"id": mid, "name": guide["author"], "guides": 0, "videos": set()})
            author["guides"] += 1; author["videos"].add(guide["bvid"])
        return [{**a, "videos": len(a["videos"])} for a in authors.values()]

    def save_author_page(self, author_id, page, payload):
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO author_pages VALUES (?,?,?,?)",
                       (str(author_id), page, now, json.dumps(payload, ensure_ascii=False, allow_nan=False)))

    def author_catalog(self, author_id):
        mid = str(author_id)
        with self.connect() as db:
            pages = db.execute("SELECT * FROM author_pages WHERE author_id=? ORDER BY page", (mid,)).fetchall()
        videos, known_pages, warnings = {}, [], []
        for row in pages:
            payload = json.loads(row["payload"])
            known_pages.append(payload); warnings.extend(payload.get("warnings", []))
            for video in payload["videos"]: videos[video["bvid"]] = {**video, "cached": True}
        for guide in self.list():
            if str(guide.get("author_id") or "") != mid: continue
            video = videos.setdefault(guide["bvid"], {"bvid": guide["bvid"], "title": guide["title"],
                "author": guide["author"], "author_id": mid, "published_at": guide.get("published_at"),
                "interactive": True, "cached": False})
            # list() is ordered newest first; keep the most recently parsed version.
            if not video.get("guide_id"): video.update(guide_id=guide["id"], saved=True)
        by_page = {p["page"]: p for p in known_pages}
        consecutive = 0
        while consecutive + 1 in by_page: consecutive += 1
        last = by_page.get(consecutive)
        return {"author_id": mid, "videos": sorted(videos.values(), key=lambda v: v.get("published_at") or 0, reverse=True),
                "next_page": consecutive + 1, "has_more": last["has_more"] if last else True,
                "scanned": last["scanned"] if last else 0,
                "total_submissions": last["total_submissions"] if last else None,
                "fetched_at": max((row["fetched_at"] for row in pages), default=None),
                "warnings": list(dict.fromkeys(warnings)), "cached_pages": len(pages)}
