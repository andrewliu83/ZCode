// 共享的有界 spec 存在性探针，供独立查询和诊断使用。
// 提示词注入不再依赖此结果；ThinkRail 开启时先通过 spec 工具确认图状态。
//
// 不建图，也不扫描整个仓库；全量索引由 SpecIndex 的查询路径负责。
// 探测的语义与 spec 索引的扫描规则对齐（store.ts 的 IGNORED_DIRS + 名字排序 + 只看 `.md`），
// 所以「探测说有」与「工具能查到」不会互相矛盾。
//
// 判据刻意宽松：**一个** frontmatter 带 non-empty id + type 的 `.md` 就够了。
// 结果只表示是否发现过一个 spec，不表示图完整，也不决定常驻规则是否可注入。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSpec, parseFile } from "./parse.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage"]);
export const SPEC_FILE_EXTENSION = ".md";

export interface WorkspaceSpecProbeOptions {
  /** 最多检查多少个 `.md` 文件就放弃（缺省 200）：探到就返回，不探到也不会扫完整仓。 */
  readonly maxFiles?: number;
  /** 最多下钻几层目录（缺省 6）：spec 树通常与代码同构，深层 node_modules 之外的嵌套很少。 */
  readonly maxDepth?: number;
}

/**
 * 这个工作区是否存在至少一个 spec？
 *
 * 任一 fs 错误（目录不存在、无权限、断链）都当作「没有」：常驻段缺席是安全方向，
 * 而不是让一条环境错误把整轮组装打断。
 */
export function workspaceHasSpec(
  workspacePath: string,
  options: WorkspaceSpecProbeOptions = {},
): boolean {
  const maxFiles = options.maxFiles ?? 200;
  const maxDepth = options.maxDepth ?? 6;
  let examined = 0;

  const walk = (dir: string, depth: number): boolean => {
    if (depth > maxDepth || examined >= maxFiles) return false;
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    // 目录与文件分开遍历：先看本层的 .md（一个文件常常就是根 SPEC.md），再下钻。
    const files: string[] = [];
    const dirs: string[] = [];
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRS.has(dirent.name)) dirs.push(dirent.name);
      } else if (dirent.isFile() && dirent.name.endsWith(SPEC_FILE_EXTENSION)) {
        files.push(dirent.name);
      }
    }
    files.sort();
    dirs.sort();
    for (const name of files) {
      examined += 1;
      if (examined > maxFiles) return false;
      if (isSpecFile(join(dir, name))) return true;
    }
    for (const name of dirs) {
      if (walk(join(dir, name), depth + 1)) return true;
    }
    return false;
  };

  try {
    if (!statSync(workspacePath, { throwIfNoEntry: false })?.isDirectory()) return false;
  } catch {
    return false;
  }
  return walk(workspacePath, 0);
}

function isSpecFile(path: string): boolean {
  try {
    const { frontmatter } = parseFile(readFileSync(path, "utf8"));
    return isSpec(frontmatter);
  } catch {
    return false;
  }
}
