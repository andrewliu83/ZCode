// ============================================================
// ThinkRail 工具模块出口
// ============================================================
// 七个 spec_* 工具（14 个里的读侧 4 个 + 写侧 3 个）。worktree_* 六个在 P3 落在这里。

import {
  specCreateToolEntry,
  specDeleteToolEntry,
  specUpdateToolEntry,
} from "./spec-write-tools.js";
import {
  specGetToolEntry,
  specGraphToolEntry,
  specGrepToolEntry,
  specValidateToolEntry,
} from "./spec-read-tools.js";
import type { ToolEntry } from "../../types.js";

export { getSpecIndex, specRoot, thinkrailHasSpec } from "./shared.js";
export { scaffoldBody } from "./spec-write-tools.js";

/** 注册顺序即模型工具表顺序：读侧三件（检索 / 查 / 走图）相邻，管理面三件随后。 */
export const thinkrailSpecToolEntries: readonly ToolEntry[] = [
  specGrepToolEntry,
  specGetToolEntry,
  specGraphToolEntry,
  specCreateToolEntry,
  specUpdateToolEntry,
  specDeleteToolEntry,
  specValidateToolEntry,
];
