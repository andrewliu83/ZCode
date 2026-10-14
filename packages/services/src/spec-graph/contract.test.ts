// ThinkRail spec 图服务契约（docs/thinkrail/design.md D7）。
// 这个契约的核心不是字段，而是三条语义：只读、每次现算、空工作区不抛错。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSpecGraphService, type ISpecGraphService } from "./index.js";

const roots: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkrail-graph-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function writeSpec(root: string, rel: string, frontmatter: string, body = "\n# Body\n"): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, `---\n${frontmatter}\n---\n${body}`);
}

const service: ISpecGraphService = createSpecGraphService();

describe("ISpecGraphService contract", () => {
  it("空工作区返回空快照而不是抛错（面板的空态比红框有用）", async () => {
    const root = tempWorkspace();
    const snapshot = await service.readSnapshot({ workspacePath: root });
    expect(snapshot.hasSpecs).toBe(false);
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.workspacePath).toBe(root);
    expect(snapshot.generatedAt).toBeGreaterThan(0);
  });

  it("工作区不存在时同样返回空快照", async () => {
    const snapshot = await service.readSnapshot({ workspacePath: "/definitely/not/here" });
    expect(snapshot.hasSpecs).toBe(false);
    expect(snapshot.nodes).toEqual([]);
  });

  it("节点带渲染需要的链接字段，边按 kind 连起来", async () => {
    const root = tempWorkspace();
    writeSpec(root, "SPEC.md", "id: root\ntype: architecture-design\ntitle: Root");
    writeSpec(
      root,
      "pkg/SPEC.md",
      [
        "id: pkg",
        "type: module-design",
        "title: Pkg",
        "status: active",
        "parent: root",
        "depends-on: [other]",
        "tags: [core]",
      ].join("\n"),
    );

    const snapshot = await service.readSnapshot({ workspacePath: root });
    expect(snapshot.hasSpecs).toBe(true);
    const pkg = snapshot.nodes.find((node) => node.id === "pkg");
    expect(pkg).toMatchObject({
      type: "module-design",
      title: "Pkg",
      status: "active",
      parent: "root",
      path: "pkg/SPEC.md",
      dependsOn: ["other"],
      tags: ["core"],
    });
    expect(snapshot.edges).toContainEqual({ from: "pkg", to: "root", kind: "parent" });
    expect(snapshot.edges).toContainEqual({ from: "pkg", to: "other", kind: "depends-on" });
  });

  it("把校验结果折成 issues（悬挂链接 / 重复 id / parent 环）", async () => {
    const root = tempWorkspace();
    writeSpec(root, "a/SPEC.md", "id: a\ntype: module-design\nparent: b");
    writeSpec(root, "b/SPEC.md", "id: b\ntype: module-design\nparent: a");
    writeSpec(root, "c/SPEC.md", "id: dup\ntype: module-design");
    writeSpec(root, "d/SPEC.md", "id: dup\ntype: module-design");
    writeSpec(root, "e/SPEC.md", "id: e\ntype: module-design\nreferences: [ghost]");

    const snapshot = await service.readSnapshot({ workspacePath: root });
    const kinds = snapshot.issues.map((issue) => issue.kind).sort();
    expect(kinds).toContain("parent-cycle");
    expect(kinds).toContain("duplicate-id");
    expect(kinds).toContain("dangling-link");
    // 每个 issue 都带得出可点的路径 —— 面板按路径跳转，空路径的 issue 是死链。
    for (const issue of snapshot.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.paths.length).toBeGreaterThan(0);
    }
  });

  it("每次调用现算：磁盘改了，下一次读就是新的（没有可失效的缓存）", async () => {
    const root = tempWorkspace();
    writeSpec(root, "SPEC.md", "id: first\ntype: module-design");
    const before = await service.readSnapshot({ workspacePath: root });
    expect(before.nodes.map((node) => node.id)).toEqual(["first"]);

    writeSpec(root, "extra/SPEC.md", "id: second\ntype: module-design");
    const after = await service.readSnapshot({ workspacePath: root });
    expect(after.nodes.map((node) => node.id).sort()).toEqual(["first", "second"]);
  });

  it("统计被跳过的目录数（解释「为什么看不到某些文件」）", async () => {
    const root = tempWorkspace();
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });
    const snapshot = await service.readSnapshot({ workspacePath: root });
    expect(snapshot.skippedDirectoryCount).toBe(2);
  });

  it("契约上没有任何写入方法（写入只经 agent 的 spec_* 工具）", () => {
    const surface = Object.keys(service);
    expect(surface).toEqual(["readSnapshot"]);
    for (const method of surface) {
      expect(method).toMatch(/^(read|list|get|load|refresh)/);
    }
  });
});
