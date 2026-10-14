// 工作区「是否有 spec」的探针（常驻段的第三条渲染条件）。
// 语义：有界、宽容 —— 任一 fs 错误按「没有」处理，绝不因为环境问题把整轮组装打断。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { workspaceHasSpec } from "../../src/spec/index.js";

const roots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkrail-probe-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function specText(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\n# Body\n`;
}

describe("workspaceHasSpec", () => {
  it("空目录 / 不存在 / 只有非 spec 的 markdown：都没有", () => {
    const root = tempRoot();
    expect(workspaceHasSpec(root)).toBe(false);
    expect(workspaceHasSpec(join(root, "does-not-exist"))).toBe(false);
    writeFileSync(join(root, "README.md"), "# 只是文档，没有 frontmatter\n");
    writeFileSync(join(root, "half.md"), specText("id: only-id"));
    expect(workspaceHasSpec(root)).toBe(false);
  });

  it("根部的 SPEC.md 就能命中", () => {
    const root = tempRoot();
    writeFileSync(join(root, "SPEC.md"), specText("id: root\ntype: architecture-design"));
    expect(workspaceHasSpec(root)).toBe(true);
  });

  it("只在子目录里也命中（与 spec 树的形状一致）", () => {
    const root = tempRoot();
    mkdirSync(join(root, "pkg", "inner"), { recursive: true });
    writeFileSync(
      join(root, "pkg", "inner", "SPEC.md"),
      specText("id: inner\ntype: module-design"),
    );
    expect(workspaceHasSpec(root)).toBe(true);
  });

  it("忽略 node_modules / .git / dist / build 下的 markdown", () => {
    const root = tempRoot();
    for (const dir of ["node_modules/pkg", ".git", "dist", "build"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "SPEC.md"), specText("id: hidden\ntype: module-design"));
    }
    expect(workspaceHasSpec(root)).toBe(false);
  });

  it("有界：超过 maxFiles 个候选文件后放弃（不做全仓扫描）", () => {
    const root = tempRoot();
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(root, `note-${String(i).padStart(2, "0")}.md`), "# 不是 spec\n");
    }
    writeFileSync(join(root, "zzz-SPEC.md"), specText("id: late\ntype: module-design"));
    // 预算 5 个文件：排在后面的那个 spec 探不到 —— 这正是「有界」的语义。
    expect(workspaceHasSpec(root, { maxFiles: 5 })).toBe(false);
    // 预算够时命中。
    expect(workspaceHasSpec(root, { maxFiles: 50 })).toBe(true);
  });
});
