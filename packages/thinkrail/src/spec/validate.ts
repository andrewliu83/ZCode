// spec 图校验 —— 移植自 JetBrains/thinkrail 的
// packages/spec-graph/core/validate.ts（MIT）。

import { LINK_KINDS, linkTargets, type SpecGraph } from "./graph.js";
import { FIELDS, scalar } from "./parse.js";

export interface DanglingLink {
  readonly from: string;
  readonly fromPath: string;
  readonly kind: string;
  readonly target: string;
}

export interface DuplicateId {
  readonly id: string;
  readonly paths: readonly string[];
}

export interface ParentCycle {
  readonly ids: readonly string[];
}

export interface ValidationReport {
  readonly danglingLinks: DanglingLink[];
  readonly duplicateIds: DuplicateId[];
  readonly parentCycles: ParentCycle[];
}

function findParentCycles(graph: SpecGraph): ParentCycle[] {
  const cycles: ParentCycle[] = [];
  const seen = new Set<string>();

  for (const startId of graph.nodes.keys()) {
    if (seen.has(startId)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let current: string | undefined = startId;

    while (current !== undefined && graph.nodes.has(current)) {
      if (onPath.has(current)) {
        const ring = path.slice(onPath.get(current));
        const key = [...ring].sort().join("\u0000");
        if (!cycles.some((c) => [...c.ids].sort().join("\u0000") === key)) {
          cycles.push({ ids: ring });
        }
        break;
      }
      if (seen.has(current)) break;
      onPath.set(current, path.length);
      path.push(current);
      const node = graph.nodes.get(current);
      current = node ? scalar(node.frontmatter, FIELDS.parent) : undefined;
    }
    for (const id of path) seen.add(id);
  }
  return cycles;
}

/** 报告悬挂链接、重复 id、parent 环三类结构问题。 */
export function validateGraph(graph: SpecGraph): ValidationReport {
  const danglingLinks: DanglingLink[] = [];
  for (const node of graph.nodes.values()) {
    for (const kind of LINK_KINDS) {
      for (const target of linkTargets(node.frontmatter, kind)) {
        if (!graph.nodes.has(target)) {
          danglingLinks.push({ from: node.id, fromPath: node.path, kind, target });
        }
      }
    }
  }

  const duplicateIds: DuplicateId[] = [...graph.duplicateIds].map(([id, paths]) => ({ id, paths }));

  return { danglingLinks, duplicateIds, parentCycles: findParentCycles(graph) };
}

export function isValid(report: ValidationReport): boolean {
  return (
    report.danglingLinks.length === 0 &&
    report.duplicateIds.length === 0 &&
    report.parentCycles.length === 0
  );
}
