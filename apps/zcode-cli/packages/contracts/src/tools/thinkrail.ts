// ============================================================
// ThinkRail spec-graph tools - contract
// ============================================================
// 七个 spec_* 工具的入参、输出与模型可见名字。
//
// 取值域（type / status / direction / edge）从 @zcode/thinkrail/vocabulary 取：模型看到的
// 枚举与解析器认的枚举是同一份常量，漏一处就是「schema 让填 A、解析器只认 B」的静默失效。

import { z } from "zod";
import {
  LINK_KINDS,
  SPEC_STATUSES,
  SPEC_TYPES,
  SLICE_DIRECTIONS,
} from "@zcode/thinkrail/vocabulary";
import { toToolJsonSchema } from "./json-schema.js";

export const SPEC_GREP_TOOL_NAME = "spec_grep";
export const SPEC_GET_TOOL_NAME = "spec_get";
export const SPEC_GRAPH_TOOL_NAME = "spec_graph";
export const SPEC_CREATE_TOOL_NAME = "spec_create";
export const SPEC_UPDATE_TOOL_NAME = "spec_update";
export const SPEC_DELETE_TOOL_NAME = "spec_delete";
export const SPEC_VALIDATE_TOOL_NAME = "spec_validate";

/** 七个工具的模型可见名字；core 的注册门按这份名单下架（includeThinkrail !== true）。 */
export const THINKRAIL_SPEC_TOOL_NAMES = [
  SPEC_GREP_TOOL_NAME,
  SPEC_GET_TOOL_NAME,
  SPEC_GRAPH_TOOL_NAME,
  SPEC_CREATE_TOOL_NAME,
  SPEC_UPDATE_TOOL_NAME,
  SPEC_DELETE_TOOL_NAME,
  SPEC_VALIDATE_TOOL_NAME,
] as const;

/** zod 的 `z.enum` 要求非空元组；取值域常量是 readonly 数组，这里只做形状转换。 */
function enumOf(values: readonly string[]): [string, ...string[]] {
  return [...values] as [string, ...string[]];
}

// -----------------------------------------------
// Output
// -----------------------------------------------

/**
 * 七个工具的输出都是**一段给模型读的文字**：与源插件同形（`{ text }`），
 * 模型看到的字符串与源插件逐字一致，不在这里重新格式化。
 */
export const ThinkrailTextOutputSchema = z.object({ text: z.string() }).strict();

export type ThinkrailTextOutput = z.infer<typeof ThinkrailTextOutputSchema>;

export const ThinkrailTextOutputJsonSchema = toToolJsonSchema(ThinkrailTextOutputSchema);

// -----------------------------------------------
// spec_grep
// -----------------------------------------------

export const SpecGrepInputSchema = z
  .object({
    pattern: z.string().describe("Regex or substring to search for within spec files."),
    regex: z
      .boolean()
      .optional()
      .describe("Treat pattern as a regular expression (default: substring)."),
    ignoreCase: z.boolean().optional().describe("Case-insensitive match (default: true)."),
    type: z.enum(enumOf(SPEC_TYPES)).optional().describe("Only search specs with this type."),
    tag: z.string().optional().describe("Only search specs carrying this tag."),
    parent: z.string().optional().describe("Only search specs whose parent is this id."),
    dependsOn: z.string().optional().describe("Only search specs that depend-on this id."),
    limit: z.number().int().optional().describe("Max matches to return (default: 200)."),
  })
  .strict();

export type SpecGrepInput = z.infer<typeof SpecGrepInputSchema>;

export const SpecGrepInputJsonSchema = toToolJsonSchema(SpecGrepInputSchema);

// -----------------------------------------------
// spec_get
// -----------------------------------------------

export const SpecGetInputSchema = z
  .object({
    id: z.string().describe("The spec id to look up."),
  })
  .strict();

export type SpecGetInput = z.infer<typeof SpecGetInputSchema>;

export const SpecGetInputJsonSchema = toToolJsonSchema(SpecGetInputSchema);

// -----------------------------------------------
// spec_graph
// -----------------------------------------------

export const SpecGraphInputSchema = z
  .object({
    root: z.string().describe("Id of the node to start from."),
    direction: z
      .enum(enumOf(SLICE_DIRECTIONS))
      .describe(
        "subtree = down the parent tree; ancestors = up the parent chain; neighbors = across an edge and its reverse.",
      ),
    depth: z.number().int().optional().describe("How many hops to expand (default: 1)."),
    edge: z
      .enum(enumOf(LINK_KINDS))
      .optional()
      .describe("For direction=neighbors: which edge kind to traverse (default: depends-on)."),
  })
  .strict();

export type SpecGraphInput = z.infer<typeof SpecGraphInputSchema>;

export const SpecGraphInputJsonSchema = toToolJsonSchema(SpecGraphInputSchema);

// -----------------------------------------------
// spec_create
// -----------------------------------------------

export const SpecCreateInputSchema = z
  .object({
    path: z
      .string()
      .describe(
        "Root-relative path for the new spec file, ending in .md (e.g. src/foo/SPEC.md). Must stay inside the project root.",
      ),
    id: z.string().describe("Unique spec id."),
    type: z.enum(enumOf(SPEC_TYPES)).describe("Spec type."),
    title: z.string().describe("Human-readable title."),
    status: z.enum(enumOf(SPEC_STATUSES)).optional().describe("Lifecycle status."),
    parent: z.string().optional().describe("Parent id (the tree edge)."),
    dependsOn: z.array(z.string()).optional().describe("depends-on link ids."),
    references: z.array(z.string()).optional().describe("references link ids."),
    implements: z.array(z.string()).optional().describe("implements link ids."),
    covers: z.array(z.string()).optional().describe("covers ids."),
    tags: z.array(z.string()).optional().describe("tags."),
  })
  .strict();

export type SpecCreateInput = z.infer<typeof SpecCreateInputSchema>;

export const SpecCreateInputJsonSchema = toToolJsonSchema(SpecCreateInputSchema);

// -----------------------------------------------
// spec_update
// -----------------------------------------------

export const SpecUpdateInputSchema = z
  .object({
    id: z.string().describe("Id of the spec to update."),
    set: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Scalar frontmatter fields to set/overwrite (e.g. title, status, parent). For list fields (depends-on/references/implements/covers/tags) use addList/removeList.",
      ),
    remove: z.array(z.string()).optional().describe("Frontmatter field names to remove entirely."),
    addList: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe("List fields (frontmatter key names with dashes) whose entries to add."),
    removeList: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe("List fields (frontmatter key names with dashes) whose entries to remove."),
  })
  .strict();

export type SpecUpdateInput = z.infer<typeof SpecUpdateInputSchema>;

export const SpecUpdateInputJsonSchema = toToolJsonSchema(SpecUpdateInputSchema);

// -----------------------------------------------
// spec_delete
// -----------------------------------------------

export const SpecDeleteInputSchema = z
  .object({
    id: z.string().describe("Id of the spec to delete."),
  })
  .strict();

export type SpecDeleteInput = z.infer<typeof SpecDeleteInputSchema>;

export const SpecDeleteInputJsonSchema = toToolJsonSchema(SpecDeleteInputSchema);

// -----------------------------------------------
// spec_validate
// -----------------------------------------------

export const SpecValidateInputSchema = z.object({}).strict();

export type SpecValidateInput = z.infer<typeof SpecValidateInputSchema>;

export const SpecValidateInputJsonSchema = toToolJsonSchema(SpecValidateInputSchema);
