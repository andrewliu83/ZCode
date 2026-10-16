# ARMS 浏览器监控（已移除）

Desktop renderer、preload 与 Main 不再注入或初始化 ARMS 浏览器监控，也不保留 collector、转发 IPC、构建端点或启用开关。错误诊断使用本地 logger；崩溃留档明确禁止上传。

实现边界与验证见[移除上报合同](../privacy/remove-reporting.md)，历史接入说明可从 Git 历史查看。
