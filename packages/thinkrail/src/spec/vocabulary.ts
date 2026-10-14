// spec 方言的取值域 —— 工具契约（@zcode/contracts 的 thinkrail 工具 schema）与领域实现
// 共用同一份常量：模型看到的枚举与解析器认的枚举不能各写一遍。
//
// 这个入口刻意不碰 node:fs（store.ts / workspace.ts 才是文件系统调用），因为 contracts
// 会被打进渲染进程的 bundle。

export {
  FIELD_ORDER,
  FIELDS,
  IDENTITY_FIELDS,
  LIST_FIELDS,
  LIST_LINK_FIELDS,
  REQUIRED_FIELDS,
  SINGLE_LINK_FIELDS,
  SPEC_STATUSES,
  SPEC_TYPES,
} from "./parse.js";
export { LINK_KINDS } from "./graph.js";
export { SLICE_DIRECTIONS } from "./query.js";
