// 七个 spec 工具的名字常量 —— 与 @zcode/contracts 的 thinkrail.ts 同字面。
//
// 为什么不直接 import @zcode/contracts：本包是**无运行时依赖**的领域层（docs/thinkrail/design.md D1），
// contracts → core 的依赖方向已经存在，反过来 import 会让「谁是底层」变得不可回答。
//
// 字面重复由测试守住：thinkrail 包的 tests/rules.test.ts 与 core 的 thinkrail-spec-tools.test.ts
// 各断言一次工具名，两处同时改才可能漂移，而漂移会立刻红。

export const SPEC_GREP_TOOL_NAME = "spec_grep";
export const SPEC_GET_TOOL_NAME = "spec_get";
export const SPEC_GRAPH_TOOL_NAME = "spec_graph";
export const SPEC_CREATE_TOOL_NAME = "spec_create";
export const SPEC_UPDATE_TOOL_NAME = "spec_update";
export const SPEC_DELETE_TOOL_NAME = "spec_delete";
export const SPEC_VALIDATE_TOOL_NAME = "spec_validate";

/** 七个工具名；core 的注册门按这份名单下架，常量在 contracts 侧另有一份（同字面）。 */
export const THINKRAIL_SPEC_TOOL_NAMES = [
  SPEC_GREP_TOOL_NAME,
  SPEC_GET_TOOL_NAME,
  SPEC_GRAPH_TOOL_NAME,
  SPEC_CREATE_TOOL_NAME,
  SPEC_UPDATE_TOOL_NAME,
  SPEC_DELETE_TOOL_NAME,
  SPEC_VALIDATE_TOOL_NAME,
] as const;
