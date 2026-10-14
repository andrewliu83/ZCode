// 工作区内部目录与草稿目录 —— 移植自 dsh-plugin-thinkrail 的 lib/worktree/registry.js（MIT）。
//
// 这份目录是「本特性自己的、永不提交的」地盘：spec 草稿（brainstorming 把 task-spec 放这里）
// 落在这里，与 `<workspace>/.zcode/` 平级但独立 —— 配置审查与 `git status` 不互相干扰。

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const WORKSPACE_INTERNAL_DIR = ".zcode-thinkrail";
export const WORKSPACE_CONTEXT_DIR = `${WORKSPACE_INTERNAL_DIR}/context`;

/**
 * 在工作区里播下 `.zcode-thinkrail/context/`，并用 `.gitignore` 的 `*` 把它藏起来。
 *
 * 对应 thinkrail 的 `ensureWorkspaceScratchDir`：给 agent 一个稳定、永不被提交的草稿落点。
 * 幂等：目录已存在就复用，`.gitignore` 已存在就跳过（`wx` 的 EEXIST）。
 */
export function ensureWorkspaceScratchDir(workspacePath: string): void {
  if (!statSync(workspacePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Workspace directory is missing: ${workspacePath}`);
  }
  let dir = workspacePath;
  for (const part of WORKSPACE_CONTEXT_DIR.split("/")) {
    dir = join(dir, part);
    const entry = statSync(dir, { throwIfNoEntry: false });
    if (!entry) mkdirSync(dir);
    else if (!entry.isDirectory()) {
      throw new Error(`Refusing to seed the scratch dir: not a real directory: ${dir}`);
    }
  }
  try {
    writeFileSync(join(dir, ".gitignore"), "*\n", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}
