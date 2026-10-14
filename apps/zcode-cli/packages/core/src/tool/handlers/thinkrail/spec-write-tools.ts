// ============================================================
// ThinkRail spec 工具（写侧）：spec_create / spec_update / spec_delete
// ============================================================
// 移植自 dsh-plugin-thinkrail 的 lib/tools/spec-tools.js（MIT）。三条判据与源逐条对齐：
//   * spec_create：路径过 resolveSpecPath 闸门；文件已存在、id 已占用、写成后不再是 spec —— 全部拒绝；
//   * spec_update：只动 frontmatter，字段序 / 注释 / 非方言字段 / 行尾由 updateFrontmatterText 保证；
//   * 写失败以文本返回，不留半成品（create 用 `wx` 独占创建）。
//
// 领域包是静态 import（与 @zcode/dynamic-workflow 同一形态），理由见 shared.ts 的头注释。

import {
  SPEC_CREATE_TOOL_NAME,
  SPEC_DELETE_TOOL_NAME,
  SPEC_UPDATE_TOOL_NAME,
  SpecCreateInputJsonSchema,
  SpecCreateInputSchema,
  SpecDeleteInputJsonSchema,
  SpecDeleteInputSchema,
  SpecUpdateInputJsonSchema,
  SpecUpdateInputSchema,
  ThinkrailTextOutputJsonSchema,
  ThinkrailTextOutputSchema,
} from "@zcode/contracts";
import {
  FIELDS,
  WORKSPACE_INTERNAL_DIR,
  ensureWorkspaceScratchDir,
  isSpec,
  parseFile,
  resolveSpecPath,
  serializeFrontmatter,
  updateFrontmatterText,
  type SpecFrontmatter,
} from "@zcode/thinkrail";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolEntry, ToolHandler } from "../../types.js";
import {
  THINKRAIL_TIMEOUT_MS,
  THINKRAIL_WRITE_MODEL_BYTES,
  errorMessage,
  fail,
  formatThinkrailText,
  getSpecIndex,
  ok,
  specRoot,
  thinkrailCancellation,
  thinkrailResultBudget,
  thinkrailTimeout,
  thinkrailTrace,
  writePermission,
} from "./shared.js";

// 脚手架标题是**约定**，不是契约：spec 模型只读 frontmatter，正文标题谁都不解析。
// 上游发的是英文（Responsibility / Boundary / …），这里发中文 —— 一个仓库的 spec 应该用
// 这个仓库自己的语言读。要改回去只动这张表。
const SCAFFOLD_HEADINGS: Record<string, readonly string[]> = {
  "module-design": ["职责", "边界"],
  "submodule-design": ["职责", "边界"],
  "architecture-design": ["驱动", "决策", "不变量", "范围之外"],
  "goal-and-requirements": ["目标", "范围"],
  "task-spec": ["目的", "待定项"],
};

export function scaffoldBody(type: string): string {
  const headings = SCAFFOLD_HEADINGS[type];
  if (!headings || headings.length === 0) return "";
  return `${headings.map((heading) => `## ${heading}\n`).join("\n")}`;
}

const SPEC_CREATE_DESCRIPTION =
  "spec_create — create a new spec file with scaffolded frontmatter (id/type/title/links) and heading stubs. " +
  "Fails if the file already exists, the id is already in use, or the path is not an indexable root-relative .md path. Edit prose afterward with the write/edit tools.";

const SPEC_UPDATE_DESCRIPTION =
  "spec_update — edit a spec's frontmatter only (scalar fields + list entries); never its prose. " +
  "Preserves the file's field order, comments, and non-dialect fields. Prose is edited with the write/edit tools.";

const SPEC_DELETE_DESCRIPTION =
  "spec_delete — delete a spec file by id. Other specs may still reference it afterward — run spec_validate to find dangling links.";

const specCreateHandler: ToolHandler = async (input, context) => {
  const args = SpecCreateInputSchema.parse(input);
  const root = specRoot(context.workingDirectory);
  const resolved = resolveSpecPath(root, args.path);
  if ("error" in resolved) return fail(resolved.error);
  const { rel, abs } = resolved;

  const index = getSpecIndex(root);
  if (existsSync(abs)) return fail(`File already exists: ${rel}`);
  if (index.graph().nodes.has(args.id)) return fail(`Spec id "${args.id}" is already in use.`);

  const frontmatter: SpecFrontmatter = { [FIELDS.id]: args.id, [FIELDS.type]: args.type };
  if (args.status !== undefined) frontmatter[FIELDS.status] = args.status;
  frontmatter[FIELDS.title] = args.title;
  if (args.parent !== undefined) frontmatter[FIELDS.parent] = args.parent;
  if (args.dependsOn?.length) frontmatter[FIELDS.dependsOn] = args.dependsOn;
  if (args.references?.length) frontmatter[FIELDS.references] = args.references;
  if (args.implements?.length) frontmatter[FIELDS.implements] = args.implements;
  if (args.covers?.length) frontmatter[FIELDS.covers] = args.covers;
  if (args.tags?.length) frontmatter[FIELDS.tags] = args.tags;

  const content = `${serializeFrontmatter(frontmatter)}\n${scaffoldBody(args.type)}`;
  if (!isSpec(parseFile(content).frontmatter)) {
    return fail(
      `Refusing to write ${rel}: the frontmatter would not be a spec (id and type must be non-empty).`,
    );
  }
  // 工作流的草稿目录（brainstorming 把 task-spec 放这里）必须自带 gitignore，否则一份
  // 「零 git 足迹」的草稿会以未跟踪文件的形式出现在 git status 里。上游由宿主在开工作区时
  // 预播；这里在第一次写入时才播，主仓库与工作树都覆盖到。
  if (rel === WORKSPACE_INTERNAL_DIR || rel.startsWith(`${WORKSPACE_INTERNAL_DIR}/`)) {
    try {
      ensureWorkspaceScratchDir(root);
    } catch (error) {
      return fail(`Failed to seed ${WORKSPACE_INTERNAL_DIR}/: ${errorMessage(error)}`);
    }
  }
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    return fail(`Failed to write ${rel}: ${errorMessage(error)}`);
  }
  return ok(`Created ${rel} (id: ${args.id}).`);
};

const specUpdateHandler: ToolHandler = async (input, context) => {
  const args = SpecUpdateInputSchema.parse(input);
  const index = getSpecIndex(specRoot(context.workingDirectory));
  const record = index.recordForId(args.id);
  if (!record) return fail(`No spec with id "${args.id}".`);

  const result = updateFrontmatterText(record.content, {
    set: args.set,
    remove: args.remove,
    addList: args.addList,
    removeList: args.removeList,
  });
  if ("error" in result) return fail(result.error);
  try {
    writeFileSync(record.abs, result.content, "utf8");
  } catch (error) {
    return fail(`Failed to write ${record.rel}: ${errorMessage(error)}`);
  }
  // 改写不会造出/删掉 spec，但 status / type 的变化由索引重校验负责；探针只需在
  // 「这个 id 是否还是 spec」可能翻转时不失效（updateFrontmatterText 拒绝任何会 un-spec 的改动）。
  return ok(`Updated frontmatter of ${record.rel} (id: ${args.id}).`);
};

const specDeleteHandler: ToolHandler = async (input, context) => {
  const args = SpecDeleteInputSchema.parse(input);
  const index = getSpecIndex(specRoot(context.workingDirectory));
  const rel = index.pathForId(args.id);
  if (!rel) return fail(`No spec with id "${args.id}".`);
  try {
    rmSync(index.absPath(rel));
  } catch (error) {
    return fail(`Failed to delete ${rel}: ${errorMessage(error)}`);
  }
  return ok(`Deleted ${rel} (id: ${args.id}).`);
};

export const specCreateToolEntry: ToolEntry = {
  capability: "Create a spec file with scaffolded frontmatter and heading stubs",
  metadata: {
    name: SPEC_CREATE_TOOL_NAME,
    description: SPEC_CREATE_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_WRITE_MODEL_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: specCreateHandler,
  inputSchema: SpecCreateInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecCreateInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: writePermission("spec_create writes a new spec file inside the workspace", {
    withPath: true,
  }),
  resultBudget: thinkrailResultBudget(THINKRAIL_WRITE_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_create writes a single file synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};

export const specUpdateToolEntry: ToolEntry = {
  capability: "Rewrite a spec's frontmatter in place, preserving field order and comments",
  metadata: {
    name: SPEC_UPDATE_TOOL_NAME,
    description: SPEC_UPDATE_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_WRITE_MODEL_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: specUpdateHandler,
  inputSchema: SpecUpdateInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecUpdateInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: writePermission("spec_update rewrites a spec's frontmatter inside the workspace", {
    withPath: false,
  }),
  resultBudget: thinkrailResultBudget(THINKRAIL_WRITE_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_update writes a single file synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};

export const specDeleteToolEntry: ToolEntry = {
  capability: "Delete a spec file by id",
  metadata: {
    name: SPEC_DELETE_TOOL_NAME,
    description: SPEC_DELETE_DESCRIPTION,
    readOnly: false,
    destructive: true,
    concurrentSafe: false,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_WRITE_MODEL_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: specDeleteHandler,
  inputSchema: SpecDeleteInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecDeleteInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: writePermission("spec_delete removes a spec file from the workspace", {
    withPath: false,
  }),
  resultBudget: thinkrailResultBudget(THINKRAIL_WRITE_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_delete removes a single file synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};
