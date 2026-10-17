# ZCode Community

ZCode Community 是基于 [ZCode](https://github.com/zai-org/ZCode) 的社区发行版，提供桌面、Web 和终端 AI 编程工作台。当前 Community 版本为 **0.1.3**，使用独立应用 ID、安装包名称和 `community-v*` 标签，与上游 3.x 版本分开安装和更新。

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://github.com/andrewliu83/ZCode/releases">下载安装包</a> ·
  <a href="https://github.com/andrewliu83/ZCode/actions/workflows/community-release.yml">构建记录</a> ·
  <a href="https://github.com/andrewliu83/ZCode/issues">问题反馈</a>
</p>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

本仓库包含客户端、后端服务、共享 UI，以及 Agent CLI 与运行时源码。

## Community 功能

- **双内核**：聊天输入框可选择 ZCode 或随包提供的 Claude Agent SDK；切换内核会创建新会话，保留未发送草稿和附件，无需预先安装 Claude CLI。
- **ThinkRail**：默认开启，提供工作流、子智能体和 spec 图工具；已有代码且确认无 spec 图时进入项目初始化流程。用户明确关闭的设置会保留。
- **按内核管理提示词**：可分别编辑基础正文，ThinkRail 等自动注入内容只读显示。
- **隐私清理**：已移除 ARMS 上报、业务事件埋点、Agent OTLP 遥测和应用内反馈上传，保留本地日志、诊断导出及模型用量统计。模型调用仍会向选定 Provider 发送任务所需上下文；插件和 MCP 的网络行为由各自配置决定。
- **独立更新**：三个桌面平台只从本仓库的 Community Releases 获取更新，不使用上游的自动更新服务。

## 下载与安装

在 [GitHub Releases](https://github.com/andrewliu83/ZCode/releases) 中选择 `community-v*` 版本。若尚无正式发行，可自行构建，或查看 [Actions](https://github.com/andrewliu83/ZCode/actions/workflows/community-release.yml) 中手动构建的 artifacts。

| 系统    | 架构                  | 安装包                      |
| ------- | --------------------- | --------------------------- |
| macOS   | Apple Silicon / arm64 | `.dmg`、`.zip`              |
| Windows | x64                   | NSIS `.exe`                 |
| Linux   | x64                   | `.AppImage`、`.deb`、`.rpm` |

macOS 打开 DMG 后，将 **ZCode Community.app** 拖入“应用程序”。未配置 Apple 证书的发行使用 ad hoc 签名，未经过 Apple 公证；首次打开被拦截时，可在“系统设置 → 隐私与安全性”中选择“仍要打开”。Windows 当前提供未做 Authenticode 签名的安装器。Linux AppImage 需要可执行权限；DEB／RPM 使用对应系统的包管理器安装。

旧的 **ZCode Preview 3.x** 需要手动安装第一份 Community 包。之后应用默认检查并提示更新，保留自动下载偏好，下载校验后可重启安装；DEB／RPM 安装更新可能需要系统授权。Community 的版本与上游版本分别比较，不会把上游 3.x 当作自己的更新。

## 上游更新记录（参考）

- 2026-10-10：更新至 ZCode v3.15.1 版本。
- 2026-9-23：更新至 ZCode v3.14.3 版本。

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent CLI 与运行时源码位于 [apps/zcode-cli/](apps/zcode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `ZCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### Web 开发

修改 Web 或后端源码时，使用开发模式：

```bash
pnpm dev:web

# 指定后端工作区（macOS / Linux）
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

该命令同时启动 Web 开发服务器（默认 `http://localhost:5173`）和后端（默认 `http://localhost:3030`）；浏览器访问前者。`/ws` 和一般 `/api` 请求代理到本地后端，`/api/v1/oauth/token` 单独代理到当前配置的产品服务。

Agent 源码修改后，执行 `pnpm --filter @zcode/cli... build` 并重启服务。需要验证完整发行包时，按下方“ZCode 命令行版”打包章节解压运行。

### ZCode 命令行版

命令行发行包包含 TUI、Web 和 Agent，统一使用 `zcode` 启动：无参数进入 TUI；第一个参数为 `--web` 时启动 Web；其他参数交给现有 Agent CLI 处理。两种模式都在本机运行，无需 Electron。

```bash
# 默认进入终端交互界面
zcode

# 启动 Web 界面
zcode --web

# 指定项目和端口，不自动打开浏览器
zcode --web --workspace /path/to/project --port 3030 --no-open

# 查看 CLI 或 Web 参数
zcode --help
zcode --web --help
```

Web 模式默认工作目录为当前目录，监听 `127.0.0.1`，默认不启用访问令牌，自动选择空闲端口并打开浏览器。访问终端输出的地址，按 `Ctrl+C` 停止服务。局域网访问可使用 `--host 0.0.0.0`；监听非本机地址时默认生成访问令牌，使用终端输出的带令牌链接。可通过 `--token` 指定令牌或 `--no-token` 关闭令牌认证。

直接启动通用 Web 服务的 HTTP 入口时，通过 `ZCODE_SERVER_AUTH_TOKEN` 配置 API／WebSocket 认证；通过程序接口创建服务时，使用 `authToken` 选项。

构建方式见下方打包章节。`pnpm build:zcode` 只生成发行包，不会替换 `PATH` 中已有的 `zcode`。如果命令仍指向旧安装或其他源码目录，macOS / Linux 可用 `command -v zcode` 检查，Windows 可用 `where.exe zcode` 检查。

### CLI 源码开发

直接开发 TUI 或 Agent 时，运行源码入口：

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# 构建 CLI 及其 workspace 依赖
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

这个入口直接运行 Agent CLI，不经过发行包的 `--web` 分流。开发 Web 用 `pnpm dev:web`；验证统一的 `zcode` 命令，用下方解压后的 `bin/zcode.mjs`。

### UI Plugin 开发

参见 [UI Plugin：能力、API 与调试](UI_PLUGIN.md)，从 Excalidraw 的画布协作示例开始，了解插件安装更新、页面 API 和宿主联调入口。

**向 `zcode-plugins` 提交插件 PR 时，必须在 PR 模板中声明是否为 UI Plugin，并填写插件名称。** 判断标准见[提交 PR 时声明插件类型](UI_PLUGIN.md#提交-pr-时声明插件类型)。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                 | 用途                                             |
| ------------------------------------ | ------------------------------------------------ |
| `ZCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.zcode/`         |
| `ZCODE_SERVER_WORKSPACE`             | Web 后端的工作区路径                             |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |
| `ZCODE_DIST_BASE_URL`                | 命令行安装脚本使用的下载根地址                   |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](third-party/README.md)。

### 桌面版

生成与 GitHub Release 相同的 Community 安装包，在对应原生系统执行：

```bash
# macOS / Apple Silicon
pnpm release:desktop -- --os mac --arch arm64

# Windows x64
pnpm release:desktop -- --os win --arch x64

# Linux x64
pnpm release:desktop -- --os linux --arch x64

# 仅查看构建计划，不执行编译
pnpm release:desktop -- --os win --arch x64 --plan
```

产物分别位于 `packages/desktop/dist/community/macos-arm64/`、`windows-x64/`、`linux-x64/`，包含安装包、更新清单和 SHA512 校验文件。构建会验证主机平台与架构，并检查随包 Agent 能否启动。

底层开发打包入口仍为 `pnpm bundle:desktop`，使用 `pnpm bundle:desktop -- --help` 查看参数；正式发行请使用上述签名和校验完整的 `release:desktop` 流程。

### GitHub 自动发行

[Community Desktop Release](.github/workflows/community-release.yml) 使用原生 macOS、Windows 和 Linux runner 构建。三个平台全部成功并通过版本、提交和摘要校验后，才公开同一个 Release。

发行前先提交并推送源码，再创建与根 `package.json` 版本一致、指向该提交的标签：

```bash
git tag community-v0.1.3
git push origin community-v0.1.3
```

重跑旧标签对应的 Actions 仍使用旧提交。修复后发布新版本和新标签，不移动旧标签。

后续可用 `pnpm release patch` 或 `pnpm release minor` 更新版本并推送发行标签。只推送 `main` 不会创建 Release；手动运行 Actions 只上传构建产物。已公开的版本不可覆盖，修改后需要递增版本。

无证书时 macOS 使用 ad hoc 签名；完整配置 Apple Secrets 后自动签名和公证。具体凭据、更新安装边界和验证记录见 [Community 发行指南](docs/desktop/community-github-release.md)。这套工作流发布桌面安装包，终端／Web 发行仍使用下方的独立打包入口。

### ZCode 命令行版

构建入口为 `pnpm build:zcode`。脚本会依次构建 CLI/TUI、后端和 Web，收集 TUI 的原生库、worker 与运行时依赖，再组装发行包；运行发行包仍需要 Node.js，版本以 `mise.toml` 为准。

打包前必须设置下载根地址 `ZCODE_DIST_BASE_URL`（可放在 `.env`、`.env.local` 或环境变量中），也可以通过 `--base-url` 传入。以下地址是占位示例，发布时替换为实际托管地址：

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# 已配置 ZCODE_DIST_BASE_URL 时
pnpm build:zcode

# 仅重新组包，复用已有的 Agent、后端和 Web 构建产物
pnpm build:zcode --skip-build

# 查看版本、输出目录等可选参数
pnpm build:zcode --help
```

默认版本取根目录 `package.json`，输出目录为 `dist/zcode/`：

- `releases/<version>/zcode-<version>.tar.gz`：运行包。
- `releases/<version>/sha256.txt`：校验摘要。
- `latest.json`、`install.sh`：版本索引和安装脚本。

完整目录可上传到配置的下载根地址。安装脚本从该地址下载运行包，默认安装到 `~/.zcode/runtime`，并在 `~/.local/bin` 创建 `zcode` 命令。安装目录可通过 `ZCODE_DIST_HOME` 修改，命令目录可通过 `ZCODE_DIST_BIN_DIR` 修改。

旧 Lite 用户需要改用上述构建命令、环境变量和新的安装脚本。新安装不会删除旧 Lite 目录，也不会迁移或删除已有会话数据。

本地调试打包产物时，可直接解压运行，无需上传或安装：

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# 默认启动 TUI
node dist/zcode/debug/zcode/bin/zcode.mjs

# 启动 Web
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

浏览器打开 `http://127.0.0.1:3030`，即可验证同一后端服务托管 Web 页面和 Agent 的完整链路。该端口需要空闲；如正在运行 `pnpm dev:web`，可改用其他 `--port`。

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/web`                                       | Web 客户端                                 |
| `packages/server`                                    | HTTP / WebSocket 服务与远程连接            |
| `packages/zcode-server-cli`                          | 独立 Server 启动与进程管理                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| `apps/zcode-cli`                                     | Agent CLI、TUI、运行时与工具               |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

## 项目声明

功能与优惠范围、维护规则、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。
