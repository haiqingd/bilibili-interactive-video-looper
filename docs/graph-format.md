# 流程 JSON 格式（schema_version = 1）

前端「导出」产生可重新导入的规范化图。`analysis` 由服务重算，可省略。`raw_edges` 可选，用于保存原始 `edgeinfo_v2` 响应，不用于执行代码。

```json
{
  "schema_version": 1,
  "metadata": {
    "bvid": "my-offline-story",
    "title": "一个评分分支",
    "author": "创作者",
    "graph_version": "1",
    "source": "import",
    "published_at": 1720000000
  },
  "root": "start",
  "graph_complete": true,
  "warnings": [],
  "variables": [{"id": "$score", "name": "评分", "value": 0, "random": false}],
  "nodes": [
    {
      "id": "start",
      "title": "起点",
      "leaf": false,
      "questions": [{"type": 2, "choices": [
        {"target": "end", "text": "帮助朋友", "condition": "", "action": "$score+=1"}
      ]}]
    },
    {"id": "end", "title": "友谊结局", "leaf": true, "questions": []}
  ]
}
```

- 节点 ID、目标 ID 和变量 ID 都必须为字符串。ID 唯一；所有非 null 目标都须存在于 nodes 中。
- `target: null` 表示当前问题结束后继续同一片段的下一问题；不能当成结束节点。
- `leaf: true` 明确表示结局。缺少选项但没有 leaf 的节点不会自动归类成结局。
- `missing: true` 表示尚未读取，必须设置 `graph_complete: false`。未知区域会阻止完整性证明。
- 问题 `type` 支持 0（自动）、1（单选继续）、2（选择）；其他类型保留但分析降级。
- 多个 questions 按提供顺序处理。若选择有跳转，则跳转到目标的第一个问题。
- `hidden` / `default` 为可选布尔元数据。路线保留自动/隐藏标记；不推断未验证的自动跳转优先级。
- 初始变量必须为有限数值，`random: true` 时不使用采样初值证明随机分支。
- 导入限制 16 MB、2,000 个节点、10,000 个选项、100 个变量。不能通过文件中的 `analysis` 字段绕过验证。

扩展真实接口时优先补充脱敏的原始响应 fixture，以及对应条件语义测试。随机机制需要确认取值域和刷新时机后才能做有限状态展开或约束求解；不应凭猜测生成确定性攻略。
