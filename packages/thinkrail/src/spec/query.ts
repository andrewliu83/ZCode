// spec 查询：内容检索与图切片 —— 移植自 JetBrains/thinkrail 的
// packages/spec-graph/core/query.ts（MIT）。

import { FIELDS, list, scalar, type SpecFrontmatter } from "./parse.js";
import type { SpecEdge, SpecGraph, SpecNode } from "./graph.js";

export const DEFAULT_GREP_LIMIT = 200;

export interface SpecContentEntry {
  readonly path: string;
  readonly content: string;
  readonly frontmatter: SpecFrontmatter;
}

export interface GrepOptions {
  readonly pattern: string;
  readonly regex?: boolean;
  readonly ignoreCase?: boolean;
  readonly limit?: number;
  /** 元数据收窄：只在这些字段匹配时搜索该文件。 */
  readonly type?: string;
  readonly parent?: string;
  readonly tag?: string;
  readonly dependsOn?: string;
}

export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly snippet: string;
}

function matchesFilters(fm: SpecFrontmatter, filters: GrepOptions): boolean {
  if (filters.type !== undefined && scalar(fm, FIELDS.type) !== filters.type) return false;
  if (filters.parent !== undefined && scalar(fm, FIELDS.parent) !== filters.parent) return false;
  if (filters.tag !== undefined && !list(fm, FIELDS.tags).includes(filters.tag)) return false;
  if (filters.dependsOn !== undefined && !list(fm, FIELDS.dependsOn).includes(filters.dependsOn)) {
    return false;
  }
  return true;
}

function buildMatcher(opts: GrepOptions): (line: string) => boolean {
  const ignoreCase = opts.ignoreCase ?? true;
  if (opts.regex) {
    const re = new RegExp(opts.pattern, ignoreCase ? "i" : "");
    return (line) => re.test(line);
  }
  if (ignoreCase) {
    const needle = opts.pattern.toLowerCase();
    return (line) => line.toLowerCase().includes(needle);
  }
  return (line) => line.includes(opts.pattern);
}

/**
 * 在 spec 文件内容里做正则 / 子串检索，可按元数据收窄。
 *
 * 逐行匹配，返回 `path:line: snippet`；达到 limit 立刻返回并标记 truncated。
 */
export function grepSpecs(
  entries: readonly SpecContentEntry[],
  opts: GrepOptions,
): { matches: GrepMatch[]; truncated: boolean } {
  const requested = Math.trunc(opts.limit ?? DEFAULT_GREP_LIMIT);
  const limit = requested > 0 ? requested : DEFAULT_GREP_LIMIT;
  const matcher = buildMatcher(opts);
  const matches: GrepMatch[] = [];
  for (const entry of entries) {
    if (!matchesFilters(entry.frontmatter, opts)) continue;
    const lines = entry.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = i === 0 ? (lines[0] ?? "").replace(/^\ufeff/, "") : (lines[i] ?? "");
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (matcher(line)) {
        if (matches.length >= limit) return { matches, truncated: true };
        matches.push({ path: entry.path, line: i + 1, snippet: line.trim() });
      }
    }
  }
  return { matches, truncated: false };
}

export const SLICE_DIRECTIONS: readonly string[] = ["subtree", "ancestors", "neighbors"];

export interface SliceOptions {
  readonly root: string;
  readonly direction: string;
  readonly depth?: number;
  readonly edge?: string;
}

export interface SpecSlice {
  readonly root: string;
  readonly direction: string;
  readonly nodes: SpecNode[];
  readonly edges: SpecEdge[];
  readonly missing: string[];
}

/**
 * 取图的一个有界切片。
 *
 * - `subtree`：沿 `parent` 反向边向下；
 * - `ancestors`：沿 `parent` 正向边向上；
 * - `neighbors`：沿指定边（默认 `depends-on`）双向各走 depth 跳。
 */
export function graphSlice(graph: SpecGraph, opts: SliceOptions): SpecSlice {
  const depth = opts.depth ?? 1;
  const included = new Set([opts.root]);
  const edges: SpecEdge[] = [];
  const seenEdges = new Set<string>();
  const missing = new Set<string>();

  const walk = (next: (id: string) => { to: string; edge: SpecEdge }[]) => {
    let frontier = [opts.root];
    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        for (const { to, edge } of next(id)) {
          const key = `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            edges.push(edge);
          }
          if (!graph.nodes.has(to)) missing.add(to);
          if (!included.has(to)) {
            included.add(to);
            nextFrontier.push(to);
          }
        }
      }
      if (nextFrontier.length === 0) break;
      frontier = nextFrontier;
    }
  };

  if (opts.direction === "subtree") {
    walk((id) =>
      (graph.reverse[FIELDS.parent]?.get(id) ?? []).map((child) => ({
        to: child,
        edge: { from: child, to: id, kind: FIELDS.parent },
      })),
    );
  } else if (opts.direction === "ancestors") {
    walk((id) =>
      (graph.forward[FIELDS.parent]?.get(id) ?? []).map((parent) => ({
        to: parent,
        edge: { from: id, to: parent, kind: FIELDS.parent },
      })),
    );
  } else {
    const edge = opts.edge ?? FIELDS.dependsOn;
    walk((id) => {
      const out = (graph.forward[edge]?.get(id) ?? []).map((to) => ({
        to,
        edge: { from: id, to, kind: edge },
      }));
      const inc = (graph.reverse[edge]?.get(id) ?? []).map((from) => ({
        to: from,
        edge: { from, to: id, kind: edge },
      }));
      return [...out, ...inc];
    });
  }

  const nodes: SpecNode[] = [];
  for (const id of included) {
    const node = graph.nodes.get(id);
    if (node) nodes.push(node);
  }
  return { root: opts.root, direction: opts.direction, nodes, edges, missing: [...missing] };
}
