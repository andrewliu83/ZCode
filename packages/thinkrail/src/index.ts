// ThinkRail 领域模型的公开入口。
//
// 这一层是纯逻辑：不认识 ZCode 的运行时、工具、会话与 UI，也不 import @zcode/core。
// 宿主接口（会话工作目录、数据目录）由 core 侧注入；设计见 docs/thinkrail/design.md。

export * from "./spec/index.js";
export { SPEC_RULE, WORKFLOW_RULE } from "./rules.js";
export {
  THINKRAIL_SKILL_FILES,
  THINKRAIL_SKILL_NAMES,
  THINKRAIL_SPEC_SKILL_NAME,
} from "./skills.js";
export {
  SPEC_CREATE_TOOL_NAME,
  SPEC_DELETE_TOOL_NAME,
  SPEC_GET_TOOL_NAME,
  SPEC_GRAPH_TOOL_NAME,
  SPEC_GREP_TOOL_NAME,
  SPEC_UPDATE_TOOL_NAME,
  SPEC_VALIDATE_TOOL_NAME,
  THINKRAIL_SPEC_TOOL_NAMES,
} from "./tool-names.js";
export {
  ensureWorkspaceScratchDir,
  WORKSPACE_CONTEXT_DIR,
  WORKSPACE_INTERNAL_DIR,
} from "./workspace.js";
