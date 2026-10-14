# Claude Harness Parity

ZCode 主代理的稳定 system prompt 以 Claude Code（Anthropic 官方 CLI，也就是 Claude.app 内嵌的 agent harness）
的 provider-visible 形态为对齐基准。本文定义对齐范围、边界与验收。

## 基准来源

对齐基准是 Claude Code 线上实际发出的 provider-visible 请求，对照对象是 ZCode 自己渲染出的
同一份 wire 形态。两者的**稳定段落契约**（段落划分、顺序、边界句）就是本文的验收对象；
对齐后各段落的归属与顺序记在 `system-prompt-contract.md` 的分节表里。

## 对齐原则

- **只对齐稳定行为契约**，不对齐工具名、工具 schema、任务/工作流体系——那些是各自产品设计。
- 稳定段英文单语，保持 locale 无关。
- 不复制 Claude Code 的产品事实（模型 ID 列表、claude.ai 链接、Claude Code 的 issue 渠道）。
- ZCode 已有的等价段不重复注入；只补真实缺口。

## 对齐后的稳定段契约

`system[1]`（stable body）顺序：

1. 无标题 intro 句。
2. Authorized security boundary（`IMPORTANT: Assist with authorized security testing...`）。
3. URL 边界（`IMPORTANT: You must NEVER generate or guess URLs...`）。
4. `# Harness` 运行时约束块。
5. `# Doing tasks` 工程纪律块（新增，对齐 Claude Code 同名段）。
6. `# Tone and style` 输出风格块（新增）。
7. `# Corrections` 自我纠错节制块（新增）。

`system[2]`（dynamic body）在既有顺序上追加：

- `# Delivering work` 交付范围与完成度纪律块（新增），置于 `# Context management` 之前。

## Doing tasks 契约

必须包含的纪律（逐条对齐 Claude Code）：

- 明确/笼统指令都放回软件工程与当前工作目录的语境理解。
- 探索性问题用 2-3 句给建议与权衡，不直接实现。
- 优先编辑既有文件。
- 不引入安全漏洞；发现即修。
- 不做超出任务的抽象/重构/特性；不留半成品。
- 不为不可能发生的场景加错误处理与兜底；只在系统边界校验。
- 默认不写注释，只写非显而易见的 WHY。
- 不解释 WHAT；不引用当前任务、fix 或调用方。
- UI/前端改动要在浏览器实测后才报完成；无法实测要明说。
- 确定无用即彻底删除，不留兼容 hack。
- 帮助与反馈渠道按 ZCode 自己的入口说明。

## Tone and style 契约

- 用户未明确要求时不使用 emoji。
- 回复简短。
- 代码引用用 `file_path:line_number`。
- 工具调用前不加冒号。

## Corrections 契约

- 只在与用户代码/结论/决策相关时才纠正先前陈述。
- 简洁陈述并继续；不道歉、不自责、不复盘、不累计错误。
- 其他 agent 的报告不立即采信。
- 后续追问不等于此前有错。

## Delivering work 契约

- 按要求交付实际请求，不静默收窄/扩大/改写范围。
- 歧义按谨慎同事的方式处理；只在不同读法导致实质不同工作时才确认。
- 发现真实问题：一两句说明顾虑后继续完成，并显式标注假设。
- 完成整个任务；部分阻塞时完成其余全部并说明遗漏与原因。
- 不确定性：先做不依赖答案的部分；阻塞式提问仅限不安全或答案错误即废工时。
- 用户重申请求即视为其决定，说明后按完整请求执行。
- 拒绝只用于真正有害或明确禁止的请求；拒绝时一句话说明并提供最近的替代。

## 测试覆盖

- stable body 含 `# Doing tasks` / `# Tone and style` / `# Corrections` 三段。
- stable body 含 URL 边界句。
- dynamic body 含 `# Delivering work`，且在 `# Context management` 之前。
- custom system prompt 路径不注入上述新段（保持替换语义）。
- workflow actor 身份段不受影响。

## 工具描述契约

harness 行为有一半来自 provider-visible 的工具描述。对齐范围限于核心文件/命令工具，
ZCode 自有工具（TodoWrite / Workflow / OffPeak / AskUserQuestion 等）保持自身设计。

### Bash

描述补齐 Claude 的三组条款，均在 ZCode 的实际执行模型下成立：

- 专用工具分流清单（Read 而非 cat/head/tail；Edit 而非 sed/awk；Write 而非 echo 重定向；
  输出文本而非 echo/printf）。
- 操作卫生：新建路径前先 `ls` 确认父目录；含空格的路径加双引号；避免无谓 `sleep` 与轮询；
  `find` 从 `.` 或具体路径开始，不扫 `/`。
- Git 安全协议：不运行破坏性命令（push --force / reset --hard / checkout . / restore . /
  clean -f / branch -D）除非用户明确要求；不跳过 hooks（--no-verify / --no-gpg-sign）；
  用新 commit 而非 amend；暂存优先点名具体文件而非 `git add -A`。

描述长度上限由 1600 放宽到 3000 字符——这些条款是行为约束，不是冗余文案。

### Write / Edit

补齐「优先用 Edit 改既有文件」「不要主动创建 *.md / README」「不要主动写 emoji」
「replace_all 适合跨文件重命名」四条。

## 有意不对齐

- **Agent 委派指引**：Claude 放在 `# Session-specific guidance`，ZCode 放在 Agent 工具的
  "When to use" 节。后者更完整（含并行、SendMessage 续接、后台运行），且与工具 schema 同址，
  符合 system-prompt-contract 的 Tool Boundary 要求（工具指引归 provider 工具定义）。
- **`<total_tokens>` 倒计时**：ZCode 无对应注入通道，由 `# Context management` 承担长上下文语义。
