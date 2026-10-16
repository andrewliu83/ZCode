# CLI Agent 本地诊断与用量

原 CLI Agent Telemetry Schema、OTLP Provider/Exporter 和 Span Writer 接口已移除，不再作为当前实现规范。完整删除范围见[移除上报合同](../privacy/remove-reporting.md)。

## 当前保留

- 本地 logger、trace 关联与模型请求诊断；
- Model Invocation Context 中的鉴权、admission 和请求依赖；
- 逐请求 token、缓存、成本与会话恢复统计；
- 任务生命周期活动通知、owner/lease 和退出屏障。

这些事实由原 Runtime、模型适配器和本地日志所有者维护，不创建遥测 Owner、远程 exporter 或额外身份上传。实现边界见[Runtime 本地诊断](reference/runtime-and-operations.md)。

旧字段表和历史设计不再是可调用产品接口；需要审计历史实现时查阅 Git 历史与 `archive/`。
