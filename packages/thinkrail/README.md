# @zcode/thinkrail

ThinkRail 的 spec-graph 与 git worktree 领域模型，逐函数移植自 MIT 源：

- upstream：JetBrains ThinkRail（`packages/spec-graph/core/**`、worktree 相关实现）
- 中间源：`dsh-plugin-thinkrail`（`lib/spec/**`、`lib/worktree/**`）

这一层是**纯逻辑**：不认识 ZCode 的运行时、工具、会话与 UI，也不 import `@zcode/core`。
宿主接口（会话工作目录、数据目录）由 core 侧注入。设计见 `docs/thinkrail/design.md`。

移植纪律（与源一致，逐函数对齐）：注释保留、字段序保留、换行风格保留；
「是不是 spec」的判据（frontmatter 有非空 `id` + `type`）不改。

## 模块

| 模块         | 内容                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `./spec`     | frontmatter 方言、派生索引（`SpecIndex`）、图、检索、切片、校验、路径闸门 |
| `./worktree` | git worktree 生命周期、花名册、ref 白名单                                 |
