# 桌面构建期可选能力

当前构建仅在本合同中控制自动更新。ARMS、业务事件、Agent OTLP 和反馈上传已经移除；历史上报环境变量和私有默认项不再被构建脚本解析，也不能重新启用这些能力。完整范围见[移除上报合同](../privacy/remove-reporting.md)。

## 自动更新

`ZCODE_AUTO_UPDATE` 取 `1`、`true` 或 `yes` 时启用，取 `0` 可显式关闭；配置由 `scripts/build-time-config.mjs` 解析。环境变量优先于 `config/private/build-defaults.json`，Community 缺省开启。最终由构建 define `__ZCODE_AUTO_UPDATE_ENABLED__` 提供给运行时；正式产品形态与启用值同时满足时才执行更新逻辑，Preview／E2E 包继续禁用正式更新。

自动更新的检测与下载保留用户授权边界，使用独立的 Community GitHub 更新源，不包含诊断资料上传。测试需要覆盖缺省开启、显式关闭、环境优先级以及发行身份隔离。

## E2E 构建缓存

所有参与生产构建配置的环境变量都必须进入 E2E 构建指纹，包括 `ZCODE_ENABLE_MAC_SIGN` 和 `ZCODE_MAC_UPDATE_MODE`。两者影响原生更新器与 ad hoc 安装助手的编译选择，改变时必须重新构建，不能复用另一安装模式的 bundle。测试同时验证配置读取字段均已声明，以及各字段变化会使指纹失效。
