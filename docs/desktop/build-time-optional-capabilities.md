# 桌面构建期可选能力

当前构建仅在本合同中控制自动更新。ARMS、业务事件、Agent OTLP 和反馈上传已经移除；历史上报环境变量和私有默认项不再被构建脚本解析，也不能重新启用这些能力。完整范围见[移除上报合同](../privacy/remove-reporting.md)。

## 自动更新

`ZCODE_AUTO_UPDATE` 取 `1`、`true` 或 `yes` 时启用；配置仍由 `scripts/build-time-config.mjs` 解析。环境变量优先于 `config/private/build-defaults.json`，缺省关闭。最终由构建 define `__ZCODE_AUTO_UPDATE_ENABLED__` 提供给运行时；正式产品形态与启用值同时满足时才执行更新逻辑。

自动更新的检测与下载保留原有授权和发布边界，不包含诊断资料上传。测试需要覆盖缺省关闭、显式启用及环境优先级。
