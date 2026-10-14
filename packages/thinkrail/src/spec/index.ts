// spec-graph 只读模型 —— 与宿主无关，可被 core 直接消费。
// 移植自 JetBrains/thinkrail 的 packages/spec-graph/core/index.ts（MIT）。

export { buildGraph, LINK_KINDS, linkTargets } from "./graph.js";
export { workspaceHasSpec } from "./probe.js";
export type { WorkspaceSpecProbeOptions } from "./probe.js";
export type { SpecEdge, SpecGraph, SpecGraphEntry, SpecNode, LinkAdjacency } from "./graph.js";
export {
  FIELD_ORDER,
  FIELDS,
  IDENTITY_FIELDS,
  isSpec,
  LIST_FIELDS,
  LIST_LINK_FIELDS,
  list,
  parseFile,
  REQUIRED_FIELDS,
  SINGLE_LINK_FIELDS,
  SPEC_STATUSES,
  SPEC_TYPES,
  scalar,
  serializeFrontmatter,
  splitFrontmatter,
  updateFrontmatterText,
} from "./parse.js";
export type {
  FrontmatterEdit,
  FrontmatterUpdate,
  ParsedSpecFile,
  SpecFrontmatter,
} from "./parse.js";
export { DEFAULT_GREP_LIMIT, graphSlice, grepSpecs, SLICE_DIRECTIONS } from "./query.js";
export type { GrepMatch, GrepOptions, SliceOptions, SpecContentEntry, SpecSlice } from "./query.js";
export {
  compareWalkEntries,
  hasWindowsNamespaceSyntax,
  isPathInsideRoot,
  resolvePathSegment,
  resolveSpecPath,
  SPEC_FILE_EXTENSION,
  SpecIndex,
  toWalkEntry,
} from "./store.js";
export type {
  PathSemantics,
  SegmentResolution,
  SpecPathResolution,
  SpecRecord,
  WalkEntry,
} from "./store.js";
export { isValid, validateGraph } from "./validate.js";
export type { DanglingLink, DuplicateId, ParentCycle, ValidationReport } from "./validate.js";
