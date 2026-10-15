// ============================================================
// ThinkRail spec 工具的公共装配
// ============================================================
// 领域逻辑在 @zcode/thinkrail（逐函数移植自 dsh-plugin-thinkrail，MIT）。这里只做四件事：
//   * 按工作区根复用 SpecIndex —— 它每次读都重校验，缓存才有意义；
//   * 独立存在性查询复用有界探针，不保留跨会话结论；提示词不依赖此查询；
//   * 把成功 / 失败折成模型可见的一段文字（与源插件同形：失败是 `Error: ...` 文本，不是异常）；
//   * 七个工具共用的 v2 契约字段（permission / resultBudget / timeout / cancellation / trace）。
//
// 为什么直接用 node:fs（不经 fileSystemPort）：与 saved-workflows 同一形态的先例 —— spec
// 文件是本地的、单个的、以 KB 计的；而 resolveSpecPath 这条路径闸门本身就是「只碰工作区内」
// 的安全边界（docs/thinkrail/design.md D10）。领域包逐函数移植，BOM / CRLF / (mtimeMs,size)
// 重校验这些不变量靠它保持一致。
//
// 静态 import 领域包，与 @zcode/dynamic-workflow 同一形态：core 的构建与测试都假定 workspace
// 包已经构建（turbo 与 pnpm -r 的依赖序保证）。

import type { ThinkrailTextOutput } from "@zcode/contracts";
import { SpecIndex, workspaceHasSpec } from "@zcode/thinkrail";
import type { ToolEntry } from "../../types.js";

export const THINKRAIL_TIMEOUT_MS = 10_000;
export const THINKRAIL_READ_MODEL_BYTES = 48_000;
export const THINKRAIL_WRITE_MODEL_BYTES = 24_000;

const specIndexes = new Map<string, SpecIndex>();

/** 每个工作区根复用一个 SpecIndex；同一个 root 复用同一实例，缓存才有意义。 */
export function getSpecIndex(root: string): SpecIndex {
  let index = specIndexes.get(root);
  if (!index) {
    index = new SpecIndex(root);
    specIndexes.set(root, index);
  }
  return index;
}

/** 工具调用真正作用的目录：会话工作区根。模型无权跨项目扫盘。 */
export function specRoot(workingDirectory: string | undefined): string {
  return workingDirectory !== undefined && workingDirectory !== "" ? workingDirectory : ".";
}

/**
 * Bugfix：进程级布尔缓存没有外部文件变化的失效依据，新会话也会继承旧的无 spec 结论。
 * 独立存在性查询复用领域层有界探针，每次读取当前事实，不参与常驻规则门控。
 */
export function thinkrailHasSpec(root: string): boolean {
  return workspaceHasSpec(root);
}

/** 工具失败统一成模型可读的一段文字（与源插件同一形状）。 */
export function fail(message: string): ThinkrailTextOutput {
  return { text: `Error: ${message}` };
}

export function ok(text: string): ThinkrailTextOutput {
  return { text };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 模型面：工具输出就是那段文字本身，不在这里重新排版。 */
export function formatThinkrailText(output: unknown): string {
  const text = (output as ThinkrailTextOutput | undefined)?.text;
  return typeof text === "string" ? text : "ThinkRail returned an invalid result.";
}

/** 只读工具：不碰工作区，不需要确认。 */
export function readPermission(reason: string): ToolEntry["permission"] {
  return {
    permission: "read",
    reason,
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  };
}

/**
 * 写工具：写的是用户仓库里的 spec 文件，与 Write/Edit 同档（workspace + 需要确认）。
 *
 * `patternSources` 只有 spec_create 能带 "path"（入参里就有路径）；spec_update / spec_delete
 * 只拿 id，路径由 id 解析出来，所以只能按工具名匹配 —— 拿 id 当路径主体去匹配会是错的。
 */
export function writePermission(
  reason: string,
  options: { withPath: boolean },
): ToolEntry["permission"] {
  const patternSources: ToolEntry["permission"]["patternSources"] = options.withPath
    ? ["path", "toolName"]
    : ["toolName"];
  return {
    permission: "edit",
    reason,
    riskLevel: "medium",
    sideEffectScope: "workspace",
    needsApproval: true,
    patternSources: [...patternSources],
    alwaysAllowPatternSources: [...patternSources],
    denyPriority: "beforeAsk",
  };
}

export function thinkrailResultBudget(maxModelBytes: number): ToolEntry["resultBudget"] {
  return {
    maxInlineBytes: maxModelBytes,
    maxModelBytes,
    strategy: "truncate",
    preview: { maxBytes: maxModelBytes, direction: "head" },
  };
}

export function thinkrailTimeout(): ToolEntry["timeout"] {
  return {
    defaultMs: THINKRAIL_TIMEOUT_MS,
    maxMs: THINKRAIL_TIMEOUT_MS,
    allowCallOverride: false,
  };
}

/** spec 读写都是同步 fs，没有可中断点；如实声明而不是假装能取消。 */
export function thinkrailCancellation(message: string): ToolEntry["cancellation"] {
  return {
    supported: false,
    cleanup: "none",
    userVisibleMessage: message,
  };
}

export function thinkrailTrace(): ToolEntry["trace"] {
  return {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  };
}
