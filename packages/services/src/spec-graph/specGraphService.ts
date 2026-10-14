import { readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  SpecGraphSnapshot,
  SpecGraphSnapshotEdge,
  SpecGraphSnapshotIssue,
  SpecGraphSnapshotNode,
} from "@zcode/shared";
import { FIELDS, SpecIndex, list, scalar, validateGraph } from "@zcode/thinkrail";
import type { ISpecGraphService } from "./specGraph.js";

/** 与领域层扫描规则一致的忽略目录：面板里的「扫描跳过了 N 个目录」按同一份名单统计。 */
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build"]);

const MAX_COUNT_DEPTH = 6;

/**
 * 工作区 spec 图的只读投影。
 *
 * 领域逻辑全在 `@zcode/thinkrail`（逐函数移植自 JetBrains ThinkRail，MIT）：这里只做
 * 「SpecIndex 的图 → 可跨进程传输的快照」这一步，不重新实现解析、校验或链接规则。
 *
 * **每次调用都现算**，不缓存：文件系统是唯一事实来源，而面板是用户主动打开的（一次遍历的
 * 成本可以接受）。缓存只会引入「面板显示的不是磁盘上的内容」这一类问题。
 */
export function createSpecGraphService(): ISpecGraphService {
  return {
    async readSnapshot(params): Promise<SpecGraphSnapshot> {
      const workspacePath = params.workspacePath;
      const graph = new SpecIndex(workspacePath).graph();
      const report = validateGraph(graph);

      const nodes: SpecGraphSnapshotNode[] = [...graph.nodes.values()]
        .map((node) => toSnapshotNode(node))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

      const edges: SpecGraphSnapshotEdge[] = graph.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
      }));

      const issues: SpecGraphSnapshotIssue[] = [
        ...report.danglingLinks.map((link) => ({
          kind: "dangling-link" as const,
          message: `${link.from} 的 ${link.kind} 指向不存在的 ${link.target}`,
          paths: [link.fromPath],
        })),
        ...report.duplicateIds.map((duplicate) => ({
          kind: "duplicate-id" as const,
          message: `id "${duplicate.id}" 出现在多个文件里`,
          paths: [...duplicate.paths],
        })),
        ...report.parentCycles.map((cycle) => ({
          kind: "parent-cycle" as const,
          message: `parent 链成环：${cycle.ids.join(" → ")}`,
          paths: cycle.ids
            .map((id) => graph.nodes.get(id)?.path)
            .filter((path): path is string => path !== undefined),
        })),
      ];

      return {
        workspacePath,
        generatedAt: Date.now(),
        nodes,
        edges,
        issues,
        hasSpecs: nodes.length > 0,
        skippedDirectoryCount: countSkippedDirectories(workspacePath),
      };
    },
  };
}

function toSnapshotNode(node: {
  id: string;
  type: string;
  title?: string;
  path: string;
  frontmatter: Parameters<typeof scalar>[0];
}): SpecGraphSnapshotNode {
  const status = scalar(node.frontmatter, FIELDS.status);
  const parent = scalar(node.frontmatter, FIELDS.parent);
  return {
    id: node.id,
    type: node.type,
    ...(node.title === undefined ? {} : { title: node.title }),
    path: node.path,
    ...(status === undefined ? {} : { status }),
    ...(parent === undefined ? {} : { parent }),
    dependsOn: list(node.frontmatter, FIELDS.dependsOn),
    references: list(node.frontmatter, FIELDS.references),
    implements: list(node.frontmatter, FIELDS.implements),
    covers: list(node.frontmatter, FIELDS.covers),
    tags: list(node.frontmatter, FIELDS.tags),
  };
}

/**
 * 跳过的目录数。
 *
 * 面板用它解释「为什么这里看不到某些文件」—— spec 放在被忽略的目录里时，用户看到的是
 * 「扫描跳过了 N 个目录」，而不是「我的文件凭空消失了」。算不出来（无权限、目录不存在）
 * 就报 0：这个数字只用于文案，不该让整次读取失败。
 */
function countSkippedDirectories(workspacePath: string): number {
  let count = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_COUNT_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        count += 1;
        continue;
      }
      walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(workspacePath, 0);
  return count;
}
