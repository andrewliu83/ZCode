import type { ModelApiActorKind, SessionTaskType } from "@zcode/contracts";

/** 模型本地诊断的角色归属来自 Runtime 的任务事实，不依赖远程追踪。 */
export function runtimeModelActorKind(taskType?: SessionTaskType): ModelApiActorKind {
  if (taskType === "subagent_child") return "subagent";
  if (taskType === "workflow_child" || taskType === "nested_workflow_child")
    return "workflow_child";
  return "main";
}
