# CLI 本地诊断与用量

当前产品已移除 Agent OTLP、ARMS、业务事件上报及反馈上传，不再提供远程 Tracer/Meter、Exporter、Span Writer 或启用配置。清理范围与验收见[移除上报合同](../privacy/remove-reporting.md)。

## 当前实现

- [CLI 本地诊断与用量](cli-agent-telemetry.md)
- [Runtime 所有者与保留边界](reference/runtime-and-operations.md)
- [本地 Usage Observability](../../apps/zcode-cli/docs/design/v2/usage-observability.md)
- [本地 Debug Observability](../../apps/zcode-cli/docs/design/v2/debug-observability.md)

本地 logger、trace 关联、Model Invocation Context、任务活动和逐请求用量继续由原所有者维护。它们不使用外部遥测出口，也不等待上报 flush。

## 历史材料

`archive/`、旧 OpenTelemetry 概念和字段字典仅用于历史审计；其中的 Span、Metric、ARMS 查询和接入方式不是当前产品接口。Desktop Renderer 操作记录器及其远程出口也已删除。

当前设计和维护规则以移除上报合同及检出源码为准，不依据历史文档恢复已删除的模块或内部依赖。
