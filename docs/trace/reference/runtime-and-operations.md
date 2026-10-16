# Runtime 本地诊断与用量边界

ARMS 和 Agent OTLP 已从当前产品移除。本页替代原来的 Provider、Exporter、Span Writer 生命周期及部署说明；不再提供启用远程上报、配置采样或 flush 的接口。详见[移除上报合同](../../privacy/remove-reporting.md)。

## 当前所有者

- CLI Runtime 持有会话、CommandInbox、模型用量和本地执行事实；trace ID 仅用于日志关联和请求诊断。
- Model Invocation Context 仍为异步鉴权、请求 admission 和本地关联提供上下文，不能因删除 OTel 而移除。
- 模型用量按真实请求收口，保留输入、输出、缓存与成本；原生 SDK 分块不能重复记账。
- Main、Host 和 renderer 通过现有 logger 与本地资源诊断输出信息，保留用户主动导出日志。
- 本地任务活动通知仍用于运行状态、远控恢复及阻止忙时退出；它不是外部遥测出口。

不再创建进程级遥测 Owner、Tracer/Meter Provider、Exporter、远程队列或上报关闭屏障。业务资源的释放继续由各自 owner 负责；没有上传任务需要刷新。
