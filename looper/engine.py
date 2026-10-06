"""Graph normalization, SCC detection, and shortest paths in (node, variables)."""
from collections import deque
import math
import re
from .expressions import evaluate, execute, ExpressionError


def components(adjacency):
    """Iterative Kosaraju; safe even for long video chains."""
    vertices = set(adjacency)
    reverse = {key: [] for key in vertices}
    for source, targets in adjacency.items():
        for target in targets:
            if target in vertices: reverse[target].append(source)
    seen, order = set(), []
    for root in adjacency:
        if root in seen: continue
        seen.add(root)
        stack = [(root, iter(adjacency[root]))]
        while stack:
            key, children = stack[-1]
            target = next(children, None)
            if target is None:
                order.append(key); stack.pop()
            elif target in vertices and target not in seen:
                seen.add(target); stack.append((target, iter(adjacency[target])))
    seen, groups = set(), []
    for root in reversed(order):
        if root in seen: continue
        group, stack = [], [root]
        seen.add(root)
        while stack:
            key = stack.pop(); group.append(key)
            for target in reverse[key]:
                if target not in seen: seen.add(target); stack.append(target)
        groups.append(group)
    return groups


def normalize_edge(data, cid=None):
    node_id = str(data["edge_id"])
    current = next((s for s in data.get("story_list", []) if str(s.get("edge_id")) == node_id), {})
    questions = []
    for qi, question in enumerate(data.get("edges", {}).get("questions", [])):
        choices = []
        for ci, choice in enumerate(question.get("choices", [])):
            platform = choice.get("platform_action", "")
            parts = platform.split()
            target = str(choice["id"]) if choice.get("cid") and choice.get("id") is not None else None
            if len(parts) >= 2 and parts[0] == "JUMP": target = parts[1]
            choices.append({"key": f"{node_id}:{qi}:{ci}", "target": target,
                            "cid": choice.get("cid"), "text": choice.get("option") or "自动跳转",
                            "condition": choice.get("condition") or "",
                            "action": choice.get("native_action") or "",
                            "hidden": bool(choice.get("is_hidden")), "default": bool(choice.get("is_default"))})
        questions.append({"title": question.get("title", ""), "type": question.get("type", 2),
                          "choices": choices})
    return {"id": node_id, "title": data.get("title") or f"片段 {node_id}",
            "cid": data.get("cid") or current.get("cid") or cid,
            "leaf": bool(data.get("is_leaf")), "questions": questions,
            "missing": False}


def validate_graph(graph):
    if not isinstance(graph, dict): raise ValueError("JSON 必须为流程对象")
    if not isinstance(graph.get("nodes"), list) or not 1 <= len(graph["nodes"]) <= 2000:
        raise ValueError("节点数量须在 1–2000 之间")
    if not isinstance(graph.get("metadata"), dict): raise ValueError("缺少 metadata")
    ids = set()
    total = 0
    for node in graph["nodes"]:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or node["id"] in ids:
            raise ValueError("节点 ID 必须为唯一字符串")
        ids.add(node["id"])
        node.setdefault("missing", False)
        if type(node.get("leaf")) is not bool or not isinstance(node.get("title"), str):
            raise ValueError("节点需要 title 和布尔 leaf")
        if not isinstance(node.get("questions"), list): raise ValueError("节点缺少 questions")
        for qi, question in enumerate(node["questions"]):
            if not isinstance(question.get("choices"), list): raise ValueError("问题缺少 choices")
            for ci, choice in enumerate(question["choices"]):
                total += 1
                choice["key"] = f"{node['id']}:{qi}:{ci}"
                for field in ("text", "condition", "action"):
                    choice.setdefault(field, "")
                    if not isinstance(choice[field], str) or len(choice[field]) > 4096:
                        raise ValueError("选项文字或表达式格式错误")
                if choice.get("target") is not None and not isinstance(choice["target"], str):
                    raise ValueError("target 必须为字符串或 null")
    if total > 10000: raise ValueError("选项数量超过 10000")
    if graph.get("root") not in ids: raise ValueError("起始节点不存在")
    for node in graph["nodes"]:
        for q in node["questions"]:
            for c in q["choices"]:
                if c.get("target") is not None and c["target"] not in ids:
                    raise ValueError(f"跳转目标不存在：{c['target']}")
    variables = graph.setdefault("variables", [])
    if not isinstance(variables, list) or len(variables) > 100: raise ValueError("变量数量无效")
    var_ids = set()
    for v in variables:
        if not isinstance(v.get("id"), str) or v["id"] in var_ids: raise ValueError("变量 ID 无效")
        var_ids.add(v["id"])
        if type(v.get("value")) not in (int, float) or not math.isfinite(v["value"]) or abs(v["value"]) > 1e12:
            raise ValueError("变量初值无效")
    graph.setdefault("warnings", [])
    if not isinstance(graph["warnings"], list): raise ValueError("warnings 格式错误")
    graph.setdefault("graph_complete", all(not n["missing"] for n in graph["nodes"]))
    return graph


VARIABLE = re.compile(r'\$[A-Za-z0-9_]+')
ASSIGNMENT = re.compile(r'\s*(\$[A-Za-z0-9_]+)\s*(=|\+=|-=|\*=|/=|%=)\s*(.+?)\s*')


def live_variables(nodes, all_variables):
    """Backward fixed point per question, including reads in every update.

    All RHS reads are kept, even for dead writes: arithmetic errors and range
    checks must have the same behavior after states merge. Assignment order
    matters; a later read after a constant write does not require the old value.
    Unsupported commands fall back to all variables at that question.
    """
    points = {(node_id, qi) for node_id, node in nodes.items()
              for qi in range(len(node['questions']) + 1)}
    live = {p: set() for p in points}
    predecessors = {p: set() for p in points}
    transitions = {}
    for point in points:
        node_id, qi = point; node = nodes[node_id]
        if node['missing']:
            live[point] = set(all_variables)
        if node['leaf'] or qi >= len(node['questions']): continue
        transitions[point] = []
        for choice in node['questions'][qi]['choices']:
            following = (choice['target'], 0) if choice.get('target') else (node_id, qi + 1)
            updates = []
            for statement in choice['action'].split(';'):
                if not statement.strip(): continue
                match = ASSIGNMENT.fullmatch(statement)
                if not match:
                    updates = None; break
                key, operator, expression = match.groups()
                reads = set(VARIABLE.findall(expression))
                if operator != '=': reads.add(key)
                updates.append((key, reads))
            transitions[point].append((following, set(VARIABLE.findall(choice['condition'])), updates))
            predecessors[following].add(point)
    queue = deque(points); pending = set(points)
    while queue:
        point = queue.popleft(); pending.remove(point)
        needed = set(live[point])
        for following, condition_reads, updates in transitions.get(point, []):
            before = set(live[following])
            if updates is None: before.update(all_variables)
            else:
                for key, reads in reversed(updates):
                    before.discard(key); before.update(reads)
            needed.update(condition_reads); needed.update(before)
        if needed != live[point]:
            live[point] = needed
            for parent in predecessors[point]:
                if parent not in pending: queue.append(parent); pending.add(parent)
    return live


def analyze(graph, max_states=20000, max_depth=300, *, reduce_states=True):
    validate_graph(graph)
    nodes = {n["id"]: n for n in graph["nodes"]}
    adjacency = {n: [c["target"] for q in v["questions"] for c in q["choices"] if c.get("target")]
                 for n, v in nodes.items()}
    cycles = [g for g in components(adjacency) if len(g) > 1 or g[0] in adjacency[g[0]]]
    warnings = list(graph.get("warnings", []))
    if not graph["graph_complete"]: warnings.append("剧情图采集不完整，未读取的分支已保留；结局列表可能不完整。")
    referenced = {key for node in nodes.values() for q in node['questions'] for c in q['choices']
                  for key in VARIABLE.findall(c['condition'] + ';' + c['action'])}
    randoms = [v for v in graph["variables"] if v.get("random") and v['id'] in referenced]
    if randoms: warnings.append("含随机变量：依赖随机值的选项未推定可达性，展示原始条件；已验证路线仅适用于不依赖随机值的分支。")
    values = {v["id"]: v["value"] for v in graph["variables"] if not v.get("random")}

    live = live_variables(nodes, {v['id'] for v in graph['variables']}) if reduce_states else None
    def state_key(node, qi, variables):
        # Python bool == int, whereas the supported JavaScript === distinguishes
        # them. Keep that distinction when hashing states.
        keys = live[node, qi] if live is not None else variables.keys()
        return (node, qi, tuple((key, 'bool' if isinstance(variables[key], bool) else 'number', variables[key])
                               for key in sorted(keys) if key in variables))

    root = state_key(graph["root"], 0, values)
    queue = deque([root]); previous = {root: None}; depths = {root: 0}
    concrete_values = {root: values}
    merged_transitions = 0
    state_edges, uncertain, reachable_nodes = {}, set(), set()
    ending_states = {}
    truncated = False
    while queue:
        state = queue.popleft()
        node_id, qi, _ = state
        variables = concrete_values[state]; node = nodes[node_id]
        state_edges[state] = []; reachable_nodes.add(node_id)
        if node["missing"]:
            uncertain.add(state); continue
        if node["leaf"]:
            ending_states.setdefault(node_id, state); continue
        if qi >= len(node["questions"]):
            uncertain.add(state)
            warnings.append(f"{node['title']} 未标记结局且缺少后续跳转，不能判定为结局。")
            continue
        if depths[state] >= max_depth:
            truncated = True; uncertain.add(state); continue
        question = node["questions"][qi]
        # Type 0 is automatic routing. Selection semantics beyond a single
        # eligible choice are deliberately left unresolved.
        eligible = []
        for choice in question["choices"]:
            try:
                if evaluate(choice["condition"], variables): eligible.append(choice)
            except ExpressionError as exc:
                uncertain.add(state)
                warnings.append(f"{node['title']} / {choice['text']}：{exc}")
        if question.get("type") == 0 and len(eligible) > 1:
            warnings.append(f"{node['title']} 存在多个同时成立的自动选项，跳转优先级待验证。")
            uncertain.add(state); continue
        if question.get("type") not in (0, 1, 2, None):
            warnings.append(f"{node['title']} 的问题类型 {question.get('type')} 尚未支持。")
            uncertain.add(state); continue
        if not eligible and state not in uncertain:
            warnings.append(f"{node['title']} 存在可达的停滞状态：没有条件成立的选项。")
        for choice in eligible:
            try: updated = execute(choice["action"], variables)
            except ExpressionError as exc:
                uncertain.add(state); warnings.append(f"{node['title']} / {choice['text']}：{exc}"); continue
            target = choice.get("target")
            following = state_key(target or node_id, 0 if target else qi + 1, updated)
            if following not in previous:
                if len(previous) >= max_states:
                    truncated = True; uncertain.add(state); continue
                previous[following] = (state, {"source": node_id, "target": target or node_id,
                    "choice": choice["text"], "key": choice["key"], "condition": choice["condition"],
                    "action": choice["action"], "before": variables, "after": updated,
                    "automatic": question.get("type") == 0 or bool(choice.get("hidden"))})
                depths[following] = depths[state] + 1
                concrete_values[following] = updated
                queue.append(following)
            elif updated != concrete_values[following]:
                merged_transitions += 1
            state_edges[state].append(following)
    if truncated: warnings.append(f"达到分析上限（{max_states} 个状态 / {max_depth} 步），无法证明所有结局均已找到。")
    endings = []
    for node in nodes.values():
        if not node["leaf"]: continue
        state = ending_states.get(node["id"])
        path = []
        cursor = state
        while cursor is not None and previous[cursor] is not None:
            cursor, step = previous[cursor]; path.append(step)
        path.reverse()
        endings.append({"id": node["id"], "title": node["title"], "reachable": state is not None,
                        "steps": path, "length": len(path) if state is not None else None,
                        "final_values": concrete_values[state] if state else None})
    traps = []
    for group in components(state_edges):
        members = set(group)
        cyclic = len(group) > 1 or group[0] in state_edges.get(group[0], [])
        if cyclic and not any(s in uncertain for s in group) and all(
            target in members for s in group for target in state_edges.get(s, [])):
            traps.append(sorted({s[0] for s in group}))
    return {"endings": endings, "cycles": cycles, "traps": traps,
            "states": len(previous), "reachable_nodes": sorted(reachable_nodes),
            "complete": bool(graph["graph_complete"] and not uncertain and not randoms and not truncated),
            "truncated": truncated, "warnings": list(dict.fromkeys(warnings)),
            "state_reduction": {"method": "future-variable-liveness" if reduce_states else "none",
                                "merged_transitions": merged_transitions,
                                "unused_variables": [v['id'] for v in graph['variables'] if v['id'] not in referenced]},
            "limits": {"states": max_states, "depth": max_depth},
            "shortest_metric": "从起点开始的最少选项转换次数（含自动跳转）"}
