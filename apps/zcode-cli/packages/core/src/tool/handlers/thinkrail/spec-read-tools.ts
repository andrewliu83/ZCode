// ============================================================
// ThinkRail spec 工具（读侧）：spec_grep / spec_get / spec_graph / spec_validate
// ============================================================
// 移植自 dsh-plugin-thinkrail 的 lib/tools/spec-tools.js（MIT）。描述、输出文字、失败
// 形状与源逐条对齐：工作流技能里引用的判据（「先 spec_grep 再 grep」、`nodes`/`edges`
// 的行格式）都依赖这些字符串。
//
// 领域包是静态 import（与 @zcode/dynamic-workflow 同一形态）：core 的构建与测试都假定 workspace
// 包已经构建。工具不在时这份代码不会被调用，注册本身不产生开销。
import {
  SPEC_GET_TOOL_NAME,
  SPEC_GRAPH_TOOL_NAME,
  SPEC_GREP_TOOL_NAME,
  SPEC_VALIDATE_TOOL_NAME,
  SpecGetInputJsonSchema,
  SpecGetInputSchema,
  SpecGraphInputJsonSchema,
  SpecGraphInputSchema,
  SpecGrepInputJsonSchema,
  SpecGrepInputSchema,
  SpecValidateInputJsonSchema,
  SpecValidateInputSchema,
  ThinkrailTextOutputJsonSchema,
  ThinkrailTextOutputSchema,
} from "@zcode/contracts";
import {
  LINK_KINDS,
  graphSlice,
  grepSpecs,
  isValid,
  linkTargets,
  validateGraph,
} from "@zcode/thinkrail";
import type { ToolEntry, ToolHandler } from "../../types.js";
import {
  THINKRAIL_READ_MODEL_BYTES,
  THINKRAIL_TIMEOUT_MS,
  fail,
  formatThinkrailText,
  ok,
  getSpecIndex,
  readPermission,
  specRoot,
  thinkrailCancellation,
  thinkrailResultBudget,
  thinkrailTimeout,
  thinkrailTrace,
} from "./shared.js";

const SPEC_GREP_DESCRIPTION =
  "spec_grep — search the project's spec-graph by content (narrowable by metadata); reach for it before grep/read when exploring or planning. " +
  "Matches within spec files only (files whose frontmatter carries `id` + `type`), optionally narrowed by type / tag / parent / depends-on. " +
  "Returns path:line matches with a snippet; read a matched file's body with the normal read tool.";

const SPEC_GET_DESCRIPTION =
  "spec_get — look up one spec by id: its frontmatter, resolved links, and path (read the body with `read`). " +
  "Resolves forward and reverse edges across parent / depends-on / references / implements. Returns no prose body.";

const SPEC_GRAPH_DESCRIPTION =
  "spec_graph — walk a bounded slice of the spec-graph (subtree / ancestors / neighbors) from a node. " +
  "`subtree` goes down the parent tree, `ancestors` up to the tree root, `neighbors` across a chosen edge and its reverse. Bounded by `depth` (default 1).";

const SPEC_VALIDATE_DESCRIPTION =
  "spec_validate — check the spec-graph for dangling links, duplicate ids, and parent cycles.";

const specGrepHandler: ToolHandler = async (input, context) => {
  const args = SpecGrepInputSchema.parse(input);
  const index = getSpecIndex(specRoot(context.workingDirectory));
  try {
    const { matches, truncated } = grepSpecs(index.contentEntries(), {
      pattern: args.pattern,
      ...(args.regex !== undefined ? { regex: args.regex } : {}),
      ...(args.ignoreCase !== undefined ? { ignoreCase: args.ignoreCase } : {}),
      ...(args.type !== undefined ? { type: args.type } : {}),
      ...(args.tag !== undefined ? { tag: args.tag } : {}),
      ...(args.parent !== undefined ? { parent: args.parent } : {}),
      ...(args.dependsOn !== undefined ? { dependsOn: args.dependsOn } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    const header =
      matches.length === 0
        ? "No matches."
        : `${matches.length} match(es)${truncated ? " (truncated)" : ""}:`;
    const body = matches.map((match) => `${match.path}:${match.line}: ${match.snippet}`).join("\n");
    return ok(`${header}\n${body}`.trimEnd());
  } catch (error) {
    return fail(
      `Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const specGetHandler: ToolHandler = async (input, context) => {
  const args = SpecGetInputSchema.parse(input);
  const graph = getSpecIndex(specRoot(context.workingDirectory)).graph();
  const node = graph.nodes.get(args.id);
  if (!node) return fail(`No spec with id "${args.id}".`);

  const links: { kind: string; target: string; path: string | null }[] = [];
  for (const kind of LINK_KINDS) {
    for (const target of linkTargets(node.frontmatter, kind)) {
      links.push({ kind, target, path: graph.nodes.get(target)?.path ?? null });
    }
  }
  const reverseLinks: { kind: string; target: string; path: string | null }[] = [];
  for (const kind of LINK_KINDS) {
    for (const source of graph.reverse[kind]?.get(args.id) ?? []) {
      reverseLinks.push({ kind, target: source, path: graph.nodes.get(source)?.path ?? null });
    }
  }

  const format = (link: { kind: string; target: string; path: string | null }) =>
    `  ${link.kind} -> ${link.target}${link.path ? ` (${link.path})` : " (missing)"}`;
  return ok(
    [
      `${node.id} [${node.type}]${node.title ? ` — ${node.title}` : ""}`,
      `path: ${node.path}`,
      links.length ? `links:\n${links.map(format).join("\n")}` : "links: (none)",
      reverseLinks.length
        ? `referenced by:\n${reverseLinks.map(format).join("\n")}`
        : "referenced by: (none)",
    ].join("\n"),
  );
};

const specGraphHandler: ToolHandler = async (input, context) => {
  const args = SpecGraphInputSchema.parse(input);
  const graph = getSpecIndex(specRoot(context.workingDirectory)).graph();
  if (!graph.nodes.has(args.root)) return fail(`No spec with id "${args.root}".`);

  const slice = graphSlice(graph, {
    root: args.root,
    direction: args.direction,
    ...(args.depth !== undefined ? { depth: args.depth } : {}),
    ...(args.edge !== undefined ? { edge: args.edge } : {}),
  });
  const nodeLines = slice.nodes.map(
    (node) => `  ${node.id} [${node.type}]${node.title ? ` — ${node.title}` : ""} (${node.path})`,
  );
  const edgeLines = slice.edges.map((edge) => `  ${edge.from} --${edge.kind}--> ${edge.to}`);
  return ok(
    [
      `Slice of "${args.root}" (${args.direction}, depth ${args.depth ?? 1}):`,
      `nodes (${slice.nodes.length}):`,
      ...nodeLines,
      `edges (${slice.edges.length}):`,
      ...edgeLines,
      slice.missing.length ? `missing targets: ${slice.missing.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
};

const specValidateHandler: ToolHandler = async (input, context) => {
  SpecValidateInputSchema.parse(input);
  const report = validateGraph(getSpecIndex(specRoot(context.workingDirectory)).graph());
  if (isValid(report)) return ok("Spec-graph is valid: no issues found.");

  const sections: string[] = [];
  if (report.duplicateIds.length) {
    sections.push(
      `Duplicate ids (${report.duplicateIds.length}):\n${report.duplicateIds
        .map((entry) => `  ${entry.id}: ${entry.paths.join(", ")}`)
        .join("\n")}`,
    );
  }
  if (report.danglingLinks.length) {
    sections.push(
      `Dangling links (${report.danglingLinks.length}):\n${report.danglingLinks
        .map(
          (link) => `  ${link.from} (${link.fromPath}) --${link.kind}--> ${link.target} [missing]`,
        )
        .join("\n")}`,
    );
  }
  if (report.parentCycles.length) {
    sections.push(
      `Parent cycles (${report.parentCycles.length}):\n${report.parentCycles
        .map((cycle) => `  ${cycle.ids.join(" -> ")} -> ${cycle.ids[0]}`)
        .join("\n")}`,
    );
  }
  return ok(sections.join("\n\n"));
};

export const specGrepToolEntry: ToolEntry = {
  capability: "Search the project's spec files by content, narrowable by frontmatter metadata",
  metadata: {
    name: SPEC_GREP_TOOL_NAME,
    description: SPEC_GREP_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_READ_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: specGrepHandler,
  inputSchema: SpecGrepInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecGrepInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: readPermission("spec_grep only reads the project's spec files"),
  resultBudget: thinkrailResultBudget(THINKRAIL_READ_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_grep scans spec files synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};

export const specGetToolEntry: ToolEntry = {
  capability: "Look up one spec by id with its resolved forward and reverse links",
  metadata: {
    name: SPEC_GET_TOOL_NAME,
    description: SPEC_GET_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_READ_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: specGetHandler,
  inputSchema: SpecGetInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecGetInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: readPermission("spec_get only reads the project's spec files"),
  resultBudget: thinkrailResultBudget(THINKRAIL_READ_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_get scans spec files synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};

export const specGraphToolEntry: ToolEntry = {
  capability: "Walk a bounded slice of the spec-graph from a node",
  metadata: {
    name: SPEC_GRAPH_TOOL_NAME,
    description: SPEC_GRAPH_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_READ_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: specGraphHandler,
  inputSchema: SpecGraphInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecGraphInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: readPermission("spec_graph only reads the project's spec files"),
  resultBudget: thinkrailResultBudget(THINKRAIL_READ_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_graph scans spec files synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};

export const specValidateToolEntry: ToolEntry = {
  capability: "Validate the spec-graph for dangling links, duplicate ids, and parent cycles",
  metadata: {
    name: SPEC_VALIDATE_TOOL_NAME,
    description: SPEC_VALIDATE_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: THINKRAIL_TIMEOUT_MS,
    maxOutputBytes: THINKRAIL_READ_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: specValidateHandler,
  inputSchema: SpecValidateInputJsonSchema,
  outputSchema: ThinkrailTextOutputJsonSchema,
  runtimeInputSchema: SpecValidateInputSchema,
  runtimeOutputSchema: ThinkrailTextOutputSchema,
  formatModelContent: formatThinkrailText,
  permission: readPermission("spec_validate only reads the project's spec files"),
  resultBudget: thinkrailResultBudget(THINKRAIL_READ_MODEL_BYTES),
  timeout: thinkrailTimeout(),
  cancellation: thinkrailCancellation(
    "spec_validate scans spec files synchronously and cannot be cancelled",
  ),
  trace: thinkrailTrace(),
};
