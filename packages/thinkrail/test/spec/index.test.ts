// spec 索引 / 图 / 检索 / 校验 / 路径闸门测试。
// 移植自 dsh-plugin-thinkrail 的 test/spec.test.js（MIT）。

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  SpecIndex,
  buildGraph,
  graphSlice,
  grepSpecs,
  isValid,
  resolveSpecPath,
  validateGraph,
  type SpecPathResolution,
} from "../../src/spec/index.js";

const roots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkrail-spec-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function specText(frontmatter: string, body = "\n# Body\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

/** 取出一次成功的路径解析；失败结果直接抛错。 */
function resolved(result: SpecPathResolution): { rel: string; abs: string } {
  if ("error" in result) throw new Error(`expected a resolved path, got: ${result.error}`);
  return result;
}

function refused(result: SpecPathResolution): string {
  if (!("error" in result)) throw new Error("expected a refusal");
  return result.error;
}

describe("resolveSpecPath", () => {
  it("accepts a root-relative .md path", () => {
    const result = resolved(resolveSpecPath(tempRoot(), "src/foo/SPEC.md"));
    expect(result.rel).toBe("src/foo/SPEC.md");
  });

  it("rejects absolute paths, non-markdown, traversal, and ignored directories", () => {
    const root = tempRoot();
    expect(refused(resolveSpecPath(root, "/etc/passwd.md"))).toMatch(/root-relative/);
    expect(refused(resolveSpecPath(root, "src/foo.txt"))).toMatch(/must end in \.md/);
    expect(refused(resolveSpecPath(root, "../escape.md"))).toMatch(/inside the project root/);
    expect(refused(resolveSpecPath(root, "node_modules/x/SPEC.md"))).toMatch(
      /ignored directory|project root/,
    );
    expect(refused(resolveSpecPath(root, ""))).toMatch(/must not be empty/);
  });

  it("refuses to walk through a symlink", () => {
    const dir = tempRoot();
    mkdirSync(join(dir, "real"), { recursive: true });
    symlinkSync(join(dir, "real"), join(dir, "link"), "dir");
    expect(refused(resolveSpecPath(dir, "link/SPEC.md"))).toMatch(/symlink/);
  });
});

describe("SpecIndex", () => {
  it("indexes specs, ignores node_modules/.git/dist/build, and follows edits", () => {
    const root = tempRoot();
    writeFileSync(join(root, "SPEC.md"), specText("id: root\ntype: architecture-design\ntitle: R"));
    mkdirSync(join(root, "pkg"), { recursive: true });
    writeFileSync(join(root, "pkg", "SPEC.md"), specText("id: pkg\ntype: module-design\ntitle: P"));
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "x", "SPEC.md"),
      specText("id: ignored\ntype: module-design\ntitle: I"),
    );
    writeFileSync(join(root, "README.md"), "# not a spec\n");

    const index = new SpecIndex(root);
    const graph = index.graph();
    expect([...graph.nodes.keys()].sort()).toEqual(["pkg", "root"]);
    expect(index.pathForId("pkg")).toBe("pkg/SPEC.md");

    // 同一个 index 实例必须看到新文件（重新校验，不是缓存住旧图）。
    writeFileSync(join(root, "NEW.md"), specText("id: fresh\ntype: task-spec\ntitle: F"));
    expect(index.graph().nodes.has("fresh")).toBe(true);

    // 删除也要跟上。
    rmSync(join(root, "NEW.md"));
    expect(index.graph().nodes.has("fresh")).toBe(false);
  });
});

describe("graph + query + validate", () => {
  const entries = [
    { path: "SPEC.md", frontmatter: { id: "root", type: "architecture-design", title: "R" } },
    {
      path: "a/SPEC.md",
      frontmatter: { id: "a", type: "module-design", title: "A", parent: "root", tags: ["x"] },
    },
    {
      path: "b/SPEC.md",
      frontmatter: {
        id: "b",
        type: "module-design",
        title: "B",
        parent: "root",
        "depends-on": ["a"],
      },
    },
  ];
  const graph = buildGraph(entries);

  it("builds forward and reverse edges", () => {
    expect(graph.reverse.parent?.get("root")).toEqual(["a", "b"]);
    expect(graph.forward["depends-on"]?.get("b")).toEqual(["a"]);
    expect(graph.edges.length).toBe(3);
  });

  it("slices subtree, ancestors, and neighbors", () => {
    const subtree = graphSlice(graph, { root: "root", direction: "subtree", depth: 2 });
    expect(subtree.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "root"]);
    const ancestors = graphSlice(graph, { root: "b", direction: "ancestors", depth: 3 });
    expect(ancestors.nodes.map((n) => n.id).sort()).toEqual(["b", "root"]);
    const neighbors = graphSlice(graph, { root: "a", direction: "neighbors", edge: "depends-on" });
    expect(neighbors.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("greps content with metadata filters and honors the limit", () => {
    const content = [
      {
        path: "a/SPEC.md",
        content: "alpha\nbeta\n",
        frontmatter: { id: "a", type: "module-design", title: "A", tags: ["x"] },
      },
      {
        path: "b/SPEC.md",
        content: "alpha\n",
        frontmatter: { id: "b", type: "module-design", title: "B" },
      },
    ];
    expect(grepSpecs(content, { pattern: "alpha" }).matches.length).toBe(2);
    expect(grepSpecs(content, { pattern: "alpha", tag: "x" }).matches.length).toBe(1);
    expect(grepSpecs(content, { pattern: "alpha", type: "task-spec" }).matches.length).toBe(0);
    const limited = grepSpecs(content, { pattern: "a", limit: 1 });
    expect(limited.matches.length).toBe(1);
    expect(limited.truncated).toBe(true);
  });

  it("validates dangling links, duplicate ids, and parent cycles", () => {
    expect(isValid(validateGraph(graph))).toBe(true);

    const broken = buildGraph([
      { path: "x.md", frontmatter: { id: "x", type: "t", parent: "gone" } },
      { path: "y1.md", frontmatter: { id: "y", type: "t" } },
      { path: "y2.md", frontmatter: { id: "y", type: "t" } },
      { path: "c1.md", frontmatter: { id: "c1", type: "t", parent: "c2" } },
      { path: "c2.md", frontmatter: { id: "c2", type: "t", parent: "c1" } },
    ]);
    const report = validateGraph(broken);
    expect(isValid(report)).toBe(false);
    expect(report.danglingLinks.map((d) => d.target)).toEqual(["gone"]);
    expect(report.duplicateIds.map((d) => d.id)).toEqual(["y"]);
    expect(report.parentCycles.length).toBe(1);
    expect([...(report.parentCycles[0]?.ids ?? [])].sort()).toEqual(["c1", "c2"]);
  });
});
