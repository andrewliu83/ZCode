---
id: zcode-community-release
type: module-spec
status: draft
title: ZCode Community 独立发行与 GitHub 自动更新
---

# 产品规则

- 分支名称为 **ZCode Community**。根 `package.json.version` 从 **0.1.0** 开始独立维护；tag 为 `community-v<version>`，不可复用上游 ZCode 的 3.x 版本序列。CHANGELOG 只将 community tag 作为后续发版基线。
- 正式应用 ID 为 `io.github.andrewliu83.zcode`，Preview 为 `.preview`；应用名、Linux package/executable、Windows AUMID 和 updater cache 独立于上游。既有会话／账号存储和 OAuth 兼容协议不在本轮迁移，不删除用户数据。
- 帮助菜单的版本历史同样打开本仓库的 GitHub Releases，不再展示上游版本记录。
- 更新发布源唯一为公开仓库 `andrewliu83/ZCode`。版本、tag 前缀、身份和仓库归属由入库的 distribution 配置声明，运行时更新不依赖模型／账号服务地址，不受上游最低版本强更影响。
- 默认启用更新检查，保留构建期显式关闭。正式 production 身份从本分支获取更新；独立 Preview 调试包、development、测试和 E2E 不自动请求发行源。
- 保留 Main 的更新状态机、单检查代次、取消、跳过版本、通道切换和退出屏障。更新偏好仍默认不自动下载。stable 只选正式 Release；接收 preview 时允许本仓库预发布，不允许版本降级。
- 更新请求不发送账号／设备 ID，也过滤 electron-updater 自动生成的 `X-User-Staging-ID` 灰度标识。
- 只有显式开发测试可覆盖更新 manifest；正常包固定 GitHub Provider。包内 publish 和 Main 运行时必须一致，不保留上游服务端更新入口。

# 构建与发布

1. GitHub Actions 接受 `community-v*` tag 和手动构建。tag 必须与根版本精确匹配，源仓库必须匹配 distribution owner/repo；手动构建默认只上传 Actions artifacts，不自动发布。
2. 交付 macOS arm64、Windows x64、Linux x64，分别使用原生 GitHub runner。macOS 提供 DMG/ZIP，Windows 提供 NSIS EXE，Linux 提供 AppImage/DEB/RPM。Node、pnpm 使用 mise.toml 与根 packageManager，依赖只使用根冻结锁。
3. workflow 显式关闭远程资产制备，只交付本地桌面资源；Electron 下载走官方地址。独立终端 SEA 和远程 server runtime 不在本次 Release 资产范围内。
4. `bundle:desktop -- --app-only` 只产出应用目录并检查运行时依赖；在签名前写入 `Resources/app-update.yml`（固定 Community GitHub 源及独立缓存），发布校验必须读取并核对该文件。签名后才压缩最终安装包，避免重复压缩。无证书时：构建 `.app` → 独立 ad hoc 签名 SDK 与原生资源 → 签整个 app → 严格校验 → 重新生成 DMG/ZIP/更新清单 → 校验 sha512 → 上传。
5. 有完整 Apple 证书及公证凭据时：自动导入临时 keychain、签名并公证／staple，随后生成最终资产。凭据配置不完整必须失败，不能无声降级；清理临时 keychain 和凭据文件。
6. 三个平台各自校验最终产物、平台更新 YAML、blockmap 与 sha512。汇总任务要求三个平台齐全、版本/tag/commit 一致，并重新验证全部摘要，拒绝资产重名；不能通过平铺下载覆盖各平台的校验文件。全部成功后才创建 draft、上传并公开同一个 Release；任何平台失败均不发布。tag push 自动发布，手动构建只上传 artifacts。
7. Windows 默认生成未配置 Authenticode 的 NSIS 包，不依赖原库的企业签名服务。Linux 由 runner 安装公开的 RPM/FUSE 打包依赖，不发布 Arch 包。各平台只有一个首期架构，更新 YAML 分别为 latest-mac.yml、latest.yml、latest-linux.yml。
8. Windows 更新沿用 NsisUpdater；Linux 按安装格式沿用 AppImageUpdater、DebUpdater 或 RpmUpdater，DEB/RPM 安装遵循系统授权，不自行增加提权实现。各平台更新均使用 Community GitHub Provider，不得跳转上游更新服务。Linux 各格式串行封装，先生成无 package-type 的 AppImage，再由 DEB/RPM 写各自标记，最终合并同版本更新清单；不能让共享资源目录并发改写包格式。
9. 每个平台在封装前用随包 Electron Node 执行 Agent `--version`，使用临时数据目录且不发送模型请求，60 秒内不能成功启动就停止发行。汇总要求每个平台有启动验证记录，不能只验证安装包文件存在。

# macOS 安装边界

- Developer ID 包可复用 Squirrel.Mac；ad hoc 包使用本分支的受控 ZIP 安装器，不能把 Squirrel 的校验失败当成功。
- ad hoc 下载复用 electron-updater 的 GitHub Provider、版本检查、缓存和事件。下载必须校验清单 sha512；解压前拒绝越界条目；解压后校验代码签名、bundle ID、目标版本和目标架构。
- 安装只替换当前 Community `.app`。拒绝原版 app、DMG／AppTranslocation／只读目录、损坏 ZIP、错误版本和错误身份。不得申请静默提权或改变系统 Gatekeeper。
- 下载／校验／staging 完成后才能发 ready。staging 位于目标同一父目录，权限隔离。Main 先停止 Host/Agent，再启动独立安装助手并退出；助手确认 Main 退出后分步重命名替换 app，失败回滚原 app，记录本地日志并重新启动。
- 安装助手用参数传递路径，不拼接 shell 代码；helper 幂等、超时不替换、失败保留原 app。没有可写安装位置时清晰提示手动安装。
- 旧 `ZCode Preview 3.15.1` 需要手动安装第一份 Community 包，之后按 Community 版本更新；不会强行降级或覆盖原 app。

```mermaid
sequenceDiagram
  participant CI as GitHub Actions
  participant R as Community Release
  participant M as Desktop Main
  participant H as 安装助手
  CI->>CI: tag/版本校验、三平台原生构建、签名按平台处理
  CI->>CI: 随包 Agent 启动、产物与摘要校验、汇总
  CI->>R: 全部成功后发布最终资产及 sha512
  M->>R: 按用户通道检查版本
  R-->>M: 版本、ZIP、摘要
  M->>M: 下载校验并 staging
  M->>M: 用户确认安装、退出屏障
  M->>H: 已验证路径、版本、父 PID
  M->>M: 退出
  H->>H: 等待 Main 退出、交换 app；失败回滚
  H->>M: 启动新 app 或原 app
```

# 验收

| ID    | 场景          | 断言                                                                                        | 证据                                |
| ----- | ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| CR-01 | 版本与身份    | 0.1.0、community tag、独立 appId/name/cache；上游 tag 不能触发发行                          | unit / workflow validation          |
| CR-02 | GitHub 更新源 | 账号 endpoint 不影响 repo；stable/preview/关闭检查符合设置，未发布时报告无可用发行          | unit / provider integration         |
| CR-03 | 无证书发包    | 真实 arm64 app 严格签名通过；DMG/ZIP/YAML 指向签名后产物                                    | local build / digest validation     |
| CR-04 | 下载安全      | 损坏校验、错误版本/身份/架构、越界 ZIP 均拒绝且原 app 保留                                  | unit / installer integration        |
| CR-05 | 自动更新安装  | 测试 app 从 0.1.0 更新为 0.1.1；等待退出、重启；交换失败回滚                                | filesystem/process integration      |
| CR-06 | 更新 UI       | 检查、下载进度、ready、取消和重启仍沿用 Main 状态机                                         | existing regressions / desktop E2E  |
| CR-07 | Apple 配置    | 无凭据走 ad hoc，部分凭据失败，完整凭据走 Developer ID+公证；不在日志输出凭据               | unit / CI when secrets configured   |
| CR-08 | 隐私及隔离    | 无旧上报依赖，无上游强更，无凭据随包，原安装与业务会话不被删除                              | scan / unit                         |
| CR-09 | Windows 发布  | 原生 x64 runner 构建 NSIS、latest.yml；身份和更新缓存独立，manifest 摘要与 EXE 一致         | native CI / release script tests    |
| CR-10 | Linux 发布    | 原生 x64 runner 构建 AppImage/DEB/RPM、latest-linux.yml；三种包可从同一更新目录选到匹配格式 | native CI / provider integration    |
| CR-11 | 多平台汇总    | 缺平台、版本/commit 不一致、摘要损坏或同名资产均阻止发布；合法三平台产物可合并              | artifact integration                |
| CR-12 | 跨平台命令    | 原生 host/arch 不匹配先失败；Windows pnpm shim 与目录边界合法；macOS 签名顺序保持           | plan / command / existing Mac tests |

# 影响说明（Impact Brief）

- 模式：planning / implementation；层级：validation、commit-effect、recovery、发行配置。
- Primary seeds：resolveDesktopProductIdentity、collectBuildMetadata、initAutoUpdater、CommunityGitHubProvider、resolveCommunityUpdater、prepareCommunityMacUpdate、runDesktopProductionBuild。
- UI Surface Matrix：帮助菜单／设置下载偏好／更新弹窗复用现有平台 IPC；显示投影归 UI，下载、检查代次和 ready 权威归 Main，跳过与偏好归 SettingService；Web/手机无独立 app updater。
- must-inspect：产品身份→打包及 Windows AUMID；版本→tag/清单；Provider→通道与 stale guard；退出屏障→安装助手。
- should-inspect：签名资源、afterPack、帮助菜单 E2E、本地日志导出。
- invariant-only：模型／账号 endpoint、conversation CommandInbox、desktop continuous/mobile replayable、workspace identity、任务用量、本地日志；均不改变所有者。
- 代码图 depth 2：tokensave 确认 identity→bundle、Provider→initAutoUpdater 的入口；脚本与 workflow 配置通过精确源码核对。现图缺少 GitHub 发行语义，是 confirmed graph delta，补入 build-release capability。
- State owner：distribution 配置持有身份/仓库，根 package 版本持有发行版本，Actions job 持有构建资产，Main 持有检查/下载状态，安装助手在 Main 退出后持有文件交换事务。
- 剪枝：不迁移既有业务存储，不改 OAuth 服务，不发布远程 runtime/CLI SEA；每个 OS 首期一个架构，暂不处理同 OS 多架构清单合并；不伪称 Apple 无证书公证可用。
- 待定用户问题：无；采用独立 Community 默认名和 0.1.0，证书缺失时支持 ad hoc。
- E2E handoff：复用 Main 更新状态机回归，帮助菜单验证 Community 版本历史和 Preview 更新禁用；本地 Provider/ZIP/进程夹具及真实 Electron 探针不访问线上 Release，不安装到真实用户 app。

# 验证结果

- macOS 首期验证：188 项更新、下载、安装、身份、菜单及既有状态机测试、9 项构建配置／发布脚本测试通过。
- Windows/Linux 扩展：127 项更新器／身份／跨平台命令回归、20 项构建配置和多平台汇总测试通过。包含 Linux 三种格式清单合并、平台 feed 解析、缺平台、版本/commit 不一致、摘要损坏、未通过 Agent 启动验证和重名拒绝。
- 真实 macOS ZIP 验证了版本、身份、架构拒绝、等待父进程退出、文件交换和损坏签名回滚；真实 Electron 探针完成检查→下载→校验→staging→ready。夹具均在临时目录，不替换实际用户安装。
- 帮助菜单 9 项桌面 E2E 通过，包含 Community Releases URL 与 Preview 不启用正式更新。
- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过；Lint 为 65 个警告、0 个错误；工作流 `actionlint` 通过。额外独立 Main TypeScript 检查仍报图标、浏览器等未修改文件的类型错误，没有将该检查记为通过。
- `pnpm release:desktop` 实际产出 Community 0.1.0 arm64 app、DMG、ZIP、更新清单、blockmap 和 SHA512 文件；最终应用严格签名、内置更新配置与 ZIP/DMG 摘要校验通过。
- 扩展后的发布入口已在本机重建 macOS 0.1.0，并用随包 Electron Node 启动 Agent（0.16.9）验证通过；产品版本与独立 Agent CLI 版本不要求相同。Windows/Linux 原生构建与安装尚未实际执行，需要首次 Actions 运行验证，不能将本地计划/清单测试算作对应平台编译通过。
- 尚未推送工作流或在线执行 GitHub Actions；未公开发布 Release。Developer ID／Apple 公证路径需要 Secrets，当前没有凭据，未计为实际执行通过。旧 Preview 3.x 需要手动安装第一份 Community 包。

# 使用方式

- 在对应原生系统执行：macOS `pnpm release:desktop -- --os mac --arch arm64`；Windows `pnpm release:desktop -- --os win --arch x64`；Linux `pnpm release:desktop -- --os linux --arch x64`。输出分别在 `packages/desktop/dist/community/macos-arm64/`、`windows-x64/`、`linux-x64/`；添加 `--plan` 仅查看配置，不要求当前主机匹配目标。实际构建在清理目录前验证 host/arch，拒绝跨平台错配。
- 首次发行：提交并推送源码后，推送 `community-v0.1.0` 标签。Actions 自动构建并发布；在 GitHub Actions 中手动运行则只上传 artifacts。后续更新根版本并创建同版本的 `community-v…` 标签，或使用 `pnpm release patch`／`minor`。
- 工作流的矩阵从 `scripts/community-release-targets.mjs` 读取：macOS 使用 `macos-15`（arm64），Windows 使用 `windows-2022`（x64），Linux 使用 `ubuntu-22.04`（x64）。Linux 安装 rpm、libfuse2、patchelf；Windows 启用长路径。所有 runner 只使用根冻结锁。
- macOS 无 Apple 凭据时无需配置 Secrets，走 ad hoc。正式签名需同时配置 `MACOS_CERTIFICATE_P12_BASE64`、`APPLE_SIGNING_IDENTITY`（Developer ID Application 完整名称）、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；加密 P12 另设 `MACOS_CERTIFICATE_PASSWORD`。进入正式签名后保持签名身份稳定。凭据不完整时失败。
- 下载构建 artifacts 时保留每个平台目录，由 `scripts/collect-community-release.mjs` 校验并汇总为一份 SHA512SUMS、构建记录和发行说明。三个平台全部成功才上传 draft，全部资产上传后才公开；已发布版本不覆盖，修改内容必须递增版本。Windows 当前未做 Authenticode 签名；DEB/RPM 更新沿用系统授权安装。
- 用户先把 Community `.app` 移到可写的安装位置。默认只检查并提示，保留自动下载偏好；下载验证后可重启更新。旧 Preview 3.x 不自动降级为 Community 0.x。
