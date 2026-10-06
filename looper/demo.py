def demo_graph():
    """A fictional fixture, deliberately includes score loops and a closed loop."""
    def c(target, text, condition="", action=""):
        return {"target": target, "text": text, "condition": condition, "action": action}
    def n(key, title, choices=None, leaf=False):
        return {"id": key, "title": title, "cid": None, "leaf": leaf,
                "questions": [{"type": 2, "choices": choices}] if choices else []}
    nodes = [
        n("start", "序章 · 雾中的来信", [c("harbor", "前往旧港口"), c("alley", "调查钟楼小巷")]),
        n("harbor", "01 · 码头的陌生人", [c("archive", "帮助船员", action="$trust=$trust+1"), c("gate", "独自前往灯塔")]),
        n("alley", "02 · 钟楼的岔路", [c("archive", "寻找旧档案", action="$clue=$clue+1"), c("loopA", "跟随神秘脚步")]),
        n("archive", "03 · 尘封的档案室", [c("practice", "翻阅航海日志", action="$clue=$clue+1"), c("gate", "带着线索离开")]),
        n("practice", "04 · 拼合遗失的线索", [c("archive", "再寻找一份日志", "$clue<2"), c("gate", "解开密码，走向灯塔", "$clue>=2")]),
        n("gate", "05 · 灯塔前的抉择", [c("good", "说出完整的真相", "$clue>=2 && $trust>=1"), c("quiet", "留下日记，悄然离开", "$clue>=1"), c("bad", "推开那扇禁忌之门")]),
        n("good", "结局 A · 天光破晓", leaf=True),
        n("quiet", "结局 B · 无声的告别", leaf=True),
        n("bad", "结局 C · 最后一盏灯", leaf=True),
        n("loopA", "迷途 · 重复的街角", [c("loopB", "继续追寻脚步")]),
        n("loopB", "迷途 · 永远的午夜", [c("loopA", "回到那个街角")]),
    ]
    return {"schema_version": 1, "metadata": {"bvid": "DEMO", "title": "雾港来信：寻找天光的三个结局",
        "author": "互动实验室", "source": "demo", "graph_version": "demo-1"},
        "root": "start", "nodes": nodes, "variables": [
            {"id": "$trust", "name": "信任值", "value": 0},
            {"id": "$clue", "name": "线索数", "value": 0}], "graph_complete": True,
        "warnings": ["这是虚构的离线示例，用于演示评分、循环和多结局；不是所提供案例视频的解析结果。"]}
