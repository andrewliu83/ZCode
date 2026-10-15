# Agent 内核与 Claude 技能匹配

## 目标与边界

用户要求：① ZCode 内核的技能匹配规则与 Claude Code 一致；② 在聊天输入框右下角直接选择 ZCode 与 Claude Agent SDK 内核，移除设置页内核切换入口。默认未选择的新草稿为 `zcode`。Claude 内核把官方 SDK 及其配套运行时作为 ZCode 的应用依赖，在构建时准备、随应用分发；不探测或执行用户单独安装的 `claude`，不依赖 PATH、全局 npm 或外部 CLI。SDK 负责原生 Agent 循环、工具和上下文管理，不能以 Claude 模型适配器代替内核。

内核选择属于 Composer 草稿；v4 `createSession.agentKernel` 必须显式携带选择，不能依赖设置或另一条创建接口。创建会话时将内核写入会话持久化配置，并通过 v4 config 投影给 UI；缺少字段的历史会话视为 `zcode`。已有会话的选择器显示绑定内核，切换内核开启独立会话并保留未提交草稿；运行或等待审批时禁止换内核。未发送的预热会话必须在选择变化时换代，迟到 ACK 不得绑定到新选择。恢复会话必须读取原绑定，不能修改已有会话、正在运行的轮次、其工具或原生会话 ID。Claude 原生会话 ID 与 ZCode 会话 ID 分开记录，SDK 原生 ID 是恢复依据，不能靠工作区路径猜测。工作区身份继续使用 `workspaceIdentity?.trim() || workspacePath`，SDK cwd 仅用真实路径。

## 所有者与接口

- Composer Draft：未提交内核选择的唯一所有者；与正文和模型选择按 workspace identity/session scope 保存。旧 AppSettings.agentKernel 仅保持配置文件兼容，不再作为聊天创建接口的隐式权威。
- CLI Session/CommandInbox：会话绑定、输入 admission、取消、事件序列、owner/lease 和 UI 投影的所有者；两种内核复用该入口。
- ZCode 内核：拥有本仓库 Model/ToolScheduler/ContextBuilder 的执行循环。
- Claude SDK 适配器：拥有 Claude 原生循环、原生工具执行、技能目录与会话恢复；向 CLI 发送类型化的已执行事件，不能再次交给 ZCode ToolScheduler 执行。
- SessionStore：保存内核与原生会话 ID，并保存由 CLI 事件序列派生的展示历史。原生恢复失败必须报错，不能静默新建会话。
- ThinkRail：规则和技能源仍来自现有包。Claude 默认接收 `claude_code` preset，显式覆盖时只替换基础正文；只读注入始终保留。内置技能通过 SDK 本地插件目录发布，spec 工具通过受控 MCP 桥发布，子代理工具白名单/黑名单中的 spec 名称在 SDK 边界转换为同一 MCP 完整名称。
- 系统提示词设置：选择只影响编辑/预览目标，不改变聊天内核；ZCode 使用 `mainSystemPrompt`，原生内核使用 `kernelSystemPrompts[kernelId]`，覆盖基础正文并保留只读扩展。Claude 默认 preset 由 SDK 管理，未取得全文时如实提示；清空恢复 preset。无会话预览按显式内核，有会话按绑定返回，详见 [内核扩展](./agent-kernel-extension.md)。
- Claude SDK 的模型与鉴权从 ZCode 的模型配置接入，能力必须兼容 SDK 支持的接口；不要求外部 Claude CLI 的安装或登录。凭据只在请求边界注入 SDK 环境，不写进 session entry、UI 投影或日志；SDK 配套运行时缺失属于打包错误，不能退回外部 CLI 或其他内核。Main 直接解析 SDK 资源，不要求同时存在原生 zcode-agent；资源未准备时不把 undefined 放入 Electron Host 环境，默认 ZCode 的启动不受影响。

```mermaid
sequenceDiagram
  participant UI as 聊天输入框
  participant Host as Host 服务
  participant Inbox as CLI CommandInbox
  participant Session as SessionStore
  participant Engine as 会话绑定的内核
  UI->>UI: 保存草稿内核选择，换代未发送预热
  UI->>Host: v4 createSession(agentKernel)
  Host->>Session: 新建时固定内核并投影 config.agentKernel
  UI->>Inbox: 提交输入（桌面 continuous / 手机 replayable）
  Inbox->>Session: 读取绑定与原生恢复 ID
  Inbox->>Engine: 串行 admission + AbortSignal
  Engine-->>Inbox: 类型化文本/已执行工具/终态事件
  Inbox->>Session: 追加同一序列与派生展示历史
  Inbox-->>UI: continuous 或 replayable 投影
```

## 技能目录一致性

以 Claude Code 当前官方技能规范为依据：仅目录 metadata 预加载，正文按需读取；技能描述是匹配依据；保留所有有效名字。默认预算按模型上下文窗口的 1% 转换为字符（现有 token 估算约 4 字符/token），模型容量未知使用 200,000 tokens；兼容显式字符预算，并支持 `SLASH_COMMAND_TOOL_CHAR_BUDGET`。单项合并 description/when_to_use 上限 1,536 字符，可通过 `skillListingMaxDescChars` 配置；默认比例 `skillListingBudgetFraction=0.01`。

标准目录不再为每项附加绝对路径。超预算从调用频率低的技能开始逐项去掉描述，频率相同时按稳定规则排序；保留全部名字，不得再整份退化。显式禁止模型调用的技能不进入模型可用目录；用户显式调用仍按独立权限验证。调用统计只记录成功加载的规范化技能身份，异步持久化，不记正文、用户输入或凭据。技能设置与模型工具说明均应区分匹配目录与加载后的步骤；调用前不得凭摘要执行技能。匹配仍由模型判断，这项对齐不引入针对中文输入的关键字硬编码路由。

## 原生内核目录策略与必需入口（2026-10-15）

Runtime 是本轮技能策略与已加载入口的唯一所有者。目录预算从本轮所选模型的能力计算（ZCode 使用 Model.properties，原生内核通过只读 ModelCatalogPort 读取同一注册表容量，不为预算创建 ZCode 模型句柄），优先级为显式字符预算 > 容量 × 比例 × 4；未知容量回落 200,000，单项默认上限 1,536。ZCode builder 和 NativeAgentRequest 复用同一 resolver。Claude 适配器将冻结后的预算显式传到 SDK 的 SLASH_COMMAND_TOOL_CHAR_BUDGET，并传递单项上限设置；不借用外部 CLI 配置，不伪造 [1m]，不在模型协议桥推断容量。SDK 保持原生目录生成和频率策略，不声称复用了 ZCode 的频率数据库。

ThinkRail 开启、主代理具备 Skill 时，Runtime 经已有 SkillPort 从获准 bundled 快照加载 choosing-a-workflow；具备 spec 读侧工具时同时加载 spec-graph。完整正文作为只读 ThinkRail 扩展进入两种内核请求及提示词检查，不受目录预算裁剪影响。入口已经加载应明确标识，不伪造 Skill 调用或成功统计，模型继续按正文加载 downstream 技能。用户/插件同名文件不作为可信入口自动加载；子代理、workflow actor、关闭和受限工具 scope 不获得超出权限的入口。加载失败或截断应明确失败，不以缺失正文继续执行。

SDK 0.3.299 默认记录整会话 system prompt，resume 会忽略新的 append/custom prompt。ZCode 要求下一轮采用新的正文/开关，因此 preset 与 custom 都显式使用 `snapshot: false`；NativeAgentRequest 在 admission 后持有冻结字符串，运行中的 query 不读设置。保留 `verbatimPrompts: false` 以启用原生技能目录。策略变化会改变提示词缓存前缀，SDK 也可能丢弃不再适用的旧 thinking；不能通过保留旧快照违背用户的下一轮生效要求。真实 SDK 回归需复用同一 native session ID，确认新入口进入供应商请求，关闭后移除旧入口。

入口随会话技能/开关快照加载，运行中不重读策略；下一轮切换清除或更新入口，保留用户/插件发现快照。workspace preview 无模型调用，使用相同 loader/renderer；会话检查使用已冻结的快照。原路由拥有调查、澄清、采纳和写作步骤，此次不另建通用工作流引擎或绕过写入审批。

```mermaid
sequenceDiagram
  participant Inbox as CLI CommandInbox
  participant Runtime as Runtime 技能快照
  participant Port as SkillPort
  participant Kernel as 已绑定内核
  Inbox->>Runtime: 接纳输入并冻结策略/模型
  Runtime->>Port: 发现获准技能并加载可信入口
  Port-->>Runtime: metadata + 完整入口正文
  Runtime->>Kernel: 已解析目录预算 + 只读入口上下文
  Kernel-->>Inbox: 原有事件和终态（continuous / replayable）
```

验收：SKL-04 不同真实模型容量、显式预算、描述上限经 NativeAgentRequest 传入真实 SDK；SKL-05 大目录中即使路由名称没有描述，实际首轮请求仍含完整路由与规范查询；SKL-06 开关/受限 scope/子代理不越权，切换后删除旧入口，加载失败不发模型请求；SKL-07 正文显示只读，保存基础提示词不覆盖入口，冷恢复与两种 v4 链路维持同一 owner。验证将使用真实 SDK + 本地协议夹具观察实际 skill_listing 和供应商请求，不把夹具当作真实模型遵从率证明。

### 本轮目录与入口修复验证

- 18 个测试文件、119 项单测与集成测试通过：覆盖共用预算、实际请求、可信加载、取消/受限 scope、目录 admission 并发、开关、提示词预览、会话恢复和两种 v4 delivery。
- 2 项发行 CommonJS / 真实 SDK 回归通过，无跳过。SDK 使用准备好的随包运行时、隔离 HOME/PATH 和本地模型接口，不读取外部 CLI 配置。96 项应用技能之外另有 SDK 自带技能，以下只统计这 96 项应用技能：

| 字符预算 | 单项描述上限 | 保留描述的应用技能 |
| --- | --- | --- |
| 8,000 | 1,536 | 1 / 96 |
| 40,000 | 1,536 | 96 / 96 |
| 40,000 | 80 | 96 / 96，实际单项均不超过 80 |
| 0 | 1,536 | 0 / 96，但全部名字保留 |

- 四种预算的供应商首轮请求都含完整路由与 spec-graph 正文，未产生 Skill 调用。真实 SDK 同一会话先模拟旧版 `snapshot: true`，再以新模式恢复，确认新 append 可见、关闭后移除入口，native session ID 不变；同时验证默认 preset 与自定义正文两条路径。
- 根目录 typecheck、lint（63 warnings / 0 errors）、architecture:check 通过；CLI contracts/adapters/core/bootstrap 类型检查及修改文件定向 lint（0 errors）通过。CLI 包级 lint 仍被 contracts 的未修改文件 max-lines 错误阻断，如 session-store.port.ts、event-reducer.ts、model/index.ts；未将其记录为通过。
- 上述真实 SDK 使用本地模型夹具，证明目录与上下文交付，不证明线上 GLM/DeepSeek 必然遵从初始化流程。本轮没有修改 UI 交互，也没有启动桌面 E2E、提交或打包。

## UI Surface Matrix

| 场景                 | 入口                  | 所有者 / 提交                     | 隔离规则                            |
| -------------------- | --------------------- | --------------------------------- | ----------------------------------- |
| 选择本次对话的内核   | 聊天输入框右下角      | Composer Draft / v4 createSession | 显式传递；换内核新建，不改旧会话    |
| 新建 / 冷恢复 / 重连 | 现有会话入口          | CLI SessionStore / CommandInbox   | 恢复按会话绑定，保留 identity/lease |
| 查看提示词           | 系统提示词设置        | 实际目标内核只读查询              | 原生基础正文不得显示为 ZCode 正文   |
| 匹配与引用技能       | 对话输入 / Skill 工具 | 内核目录与 SkillPort              | 用户 / 插件 scope 权限保持          |

## 回归与验收

- SKL-01：目录超预算仍保留所有名字，高频技能描述保留，低频逐项裁剪；正常预算保留 FIRST；无绝对路径开销。
- SKL-02：模型窗口、显式字符预算、比例、单项上限合法性；1,024 字符以上的有效描述不应在发现阶段被丢弃。
- SKL-03：禁止隐式调用的技能不会被模型匹配；成功加载更新统计，失败不更新；插件具名身份不混淆。
- KER-01：输入框选择、草稿持久化、v4 创建参数及运行时绑定一致；无显式选择为 zcode，设置页不再提供切换入口。
- KER-02：切换内核开启独立会话并保留草稿；旧 zcode/claude 会话分别恢复原内核；原生 ID 持久化；预热换代不重放已接纳输入。
- KER-03：Claude 官方 SDK 的真实 query 调用、preset、skills、ThinkRail 注入与 spec MCP；流式文字和工具结果出现在现有时间线。
- KER-04：许可、询问（包括 yolo 下的 AskUserQuestion）、取消、连续排队输入、错误、原生恢复失败都有可观察终态。附件沿用已有不可变存储和解析，按 SDK 用户消息内容块传递，不丢失原始输入。SDK usage 投影到同一会话用量事件，并作为整轮汇总保存一次；冷恢复的回复有完成时间，供应商关联使用 ZCode 中实际选择的连接。
- KER-05：桌面 continuous 和手机 replayable 使用同一 Host attachment，不另起手机 Agent；远程 identity 隔离。
- KER-06：在无系统 `claude` 命令、无全局 SDK、无外部 CLI 登录的环境中，通过应用依赖中的 SDK/runtime 执行。macOS/Windows/Linux 按目标平台随包准备对应运行时；资源缺失与接口不兼容明确报错，不假装使用其他内核。

交互验收覆盖输入框选择、预热换代和真实 v4 新会话绑定，验收案例及本轮已完成的 279 项回归、3 项桌面 E2E 记录见 [聊天内核选择](./ui/chat-agent-kernel.md)。类型检查、Lint、架构检查和 core/bootstrap 检查必须执行并如实记录。

## 旧设置入口阶段验证记录（不代表聊天选择已通过）

- 106 项相关单测/集成测试通过：根目录 75 项，CLI 31 项；覆盖预算裁剪、规范技能计数、SDK 事件桥、附件与询问、子代理工具边界、冷恢复及系统提示词查询。
- 1 项桌面 E2E 通过：设置内核选择、持久化、工作区 SDK 预览及外部切回 ZCode 后的提示词/控件刷新。
- 真实 SDK 在隔离 HOME/PATH、无外部 CLI 登录条件下通过本地 Anthropic 接口夹具运行。确认工作流规则与 FIRST 描述进入请求，Skill 正文返回后续请求；AskUserQuestion 答案返回，spec MCP 桥执行一次。夹具验证接线，不证明真实模型每次遵守技能路由。
- 根目录类型检查、Lint（63 warnings / 0 errors）及架构检查通过；CLI contracts/adapters/core/bootstrap 类型检查和当前 Agent JS bundle 构建通过。
- 根锁文件冻结/离线校验通过。CLI 包级 Lint 仍有既有文件超过 400 行的错误；新增内核模块定向 Lint 无错误。
- 当前 Claude 的原生协议为 Anthropic Messages；其它已注册上游接口通过受控模型协议桥复用现有 Model/鉴权/重试端口。API 协议支持不代表媒体、原生搜索、精确 token 计数或 signed thinking 全部等价；无法转换时明确报错。按内核覆盖提示词及验证见 [内核扩展](./agent-kernel-extension.md)。
- 这轮未创建提交，也未生成新的 macOS 安装包。
