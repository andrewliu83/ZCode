// spec 工具面的判据（docs/thinkrail/design.md §6 的 A1–A5）：
//   * 七个工具都声明 v2 公共契约；
//   * 注册门是**用户开关**：只有显式 true 才上架（与动态工作流的灰度门折叠方向相反）；
//   * 空目录（无 git）也能建图、建 spec —— spec 图不依赖 git；
//   * 路径闸门 / id 占用 / 覆写保护 / 失败即文本，逐条钉在自己的用例里。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  SPEC_CREATE_TOOL_NAME,
  SPEC_DELETE_TOOL_NAME,
  SPEC_GET_TOOL_NAME,
  SPEC_GRAPH_TOOL_NAME,
  SPEC_GREP_TOOL_NAME,
  SPEC_UPDATE_TOOL_NAME,
  SPEC_VALIDATE_TOOL_NAME,
  THINKRAIL_SPEC_TOOL_NAMES,
  type ThinkrailTextOutput,
} from "@zcode/contracts";
import { registerBuiltInTools } from "../src/tool/handlers/index.js";
import { thinkrailSpecToolEntries } from "../src/tool/handlers/thinkrail/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { expectV2CommonContract } from "./tool-contract-assertions.js";
import type { ToolEntry, ToolExecutionContext } from "../src/tool/types.js";

const roots: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkrail-core-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function context(workingDirectory: string): ToolExecutionContext {
  return {
    abortSignal: new AbortController().signal,
    sessionId: "sess_thinkrail" as never,
    toolCallId: "tool_thinkrail",
    traceId: "trace_thinkrail" as never,
    workingDirectory,
    workspaceRoot: workingDirectory,
  };
}

function entryOf(name: string): ToolEntry {
  const entry = thinkrailSpecToolEntries.find((candidate) => candidate.metadata.name === name);
  if (!entry) throw new Error(`missing tool entry: ${name}`);
  return entry;
}

async function run(name: string, input: unknown, workingDirectory: string): Promise<string> {
  const output = (await entryOf(name).handler(
    input,
    context(workingDirectory),
  )) as ThinkrailTextOutput;
  return output.text;
}

function registeredToolNames(options: Parameters<typeof registerBuiltInTools>[1]): string[] {
  const registry = createToolRegistry();
  registerBuiltInTools(registry, options);
  return registry.list();
}

describe("thinkrail spec tools", () => {
  it("declares the v2 common contract on all seven tools", () => {
    expect(thinkrailSpecToolEntries.map((entry) => entry.metadata.name)).toEqual([
      ...THINKRAIL_SPEC_TOOL_NAMES,
    ]);
    for (const entry of thinkrailSpecToolEntries) expectV2CommonContract(entry);
  });

  it("gates registration on the user switch: only an explicit true registers them", () => {
    const off = registeredToolNames({});
    for (const name of THINKRAIL_SPEC_TOOL_NAMES) expect(off).not.toContain(name);

    const explicitOff = registeredToolNames({ includeThinkrail: false });
    for (const name of THINKRAIL_SPEC_TOOL_NAMES) expect(explicitOff).not.toContain(name);

    const on = registeredToolNames({ includeThinkrail: true });
    for (const name of THINKRAIL_SPEC_TOOL_NAMES) expect(on).toContain(name);

    // 开关只加不减：与开关无关的既有工具面在两种取值下都在。
    expect(on).toContain("Read");
    expect(off).toContain("Read");
    expect(on).toContain("Bash");
    expect(off).toContain("Bash");
  });

  it("builds and edits a spec graph in a directory that is not a git repository (A1)", async () => {
    const root = tempWorkspace();
    const created = await run(
      SPEC_CREATE_TOOL_NAME,
      {
        path: "SPEC.md",
        id: "root",
        type: "architecture-design",
        title: "Root",
        tags: ["core"],
      },
      root,
    );
    expect(created).toBe("Created SPEC.md (id: root).");
    expect(readFileSync(join(root, "SPEC.md"), "utf8")).toContain("## 驱动");

    const nested = await run(
      SPEC_CREATE_TOOL_NAME,
      {
        path: "pkg/SPEC.md",
        id: "pkg",
        type: "module-design",
        title: "Pkg",
        parent: "root",
        dependsOn: ["root"],
      },
      root,
    );
    expect(nested).toBe("Created pkg/SPEC.md (id: pkg).");

    const fetched = await run(SPEC_GET_TOOL_NAME, { id: "pkg" }, root);
    expect(fetched).toContain("pkg [module-design] — Pkg");
    expect(fetched).toContain("parent -> root (SPEC.md)");
    expect(fetched).toContain("referenced by:");

    const slice = await run(SPEC_GRAPH_TOOL_NAME, { root: "root", direction: "subtree" }, root);
    expect(slice).toContain('Slice of "root" (subtree, depth 1):');
    expect(slice).toContain("  pkg [module-design] — Pkg (pkg/SPEC.md)");
    expect(slice).toContain("  pkg --parent--> root");

    const grep = await run(SPEC_GREP_TOOL_NAME, { pattern: "Pkg" }, root);
    expect(grep).toContain("2 match(es):");
    expect(grep).toContain("pkg/SPEC.md:");

    expect(await run(SPEC_VALIDATE_TOOL_NAME, {}, root)).toBe(
      "Spec-graph is valid: no issues found.",
    );
  });

  it("refuses to overwrite a file or reuse an id, and keeps the path gate (A5)", async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, "taken.md"), "---\nid: taken\ntype: module-design\n---\n");

    const duplicateId = await run(
      SPEC_CREATE_TOOL_NAME,
      { path: "other.md", id: "taken", type: "module-design", title: "T" },
      root,
    );
    expect(duplicateId).toBe('Error: Spec id "taken" is already in use.');

    const existingFile = await run(
      SPEC_CREATE_TOOL_NAME,
      { path: "taken.md", id: "fresh", type: "module-design", title: "F" },
      root,
    );
    expect(existingFile).toBe("Error: File already exists: taken.md");

    const traversal = await run(
      SPEC_CREATE_TOOL_NAME,
      { path: "../escape.md", id: "escape", type: "module-design", title: "E" },
      root,
    );
    expect(traversal).toMatch(/^Error: Path must stay inside the project root/);

    const ignored = await run(
      SPEC_CREATE_TOOL_NAME,
      { path: "node_modules/x/SPEC.md", id: "ignored", type: "module-design", title: "I" },
      root,
    );
    expect(ignored).toMatch(/^Error: /);
  });

  it("updates frontmatter without touching prose, then reports dangling links (A2, A4)", async () => {
    const root = tempWorkspace();
    await run(
      SPEC_CREATE_TOOL_NAME,
      { path: "a.md", id: "a", type: "task-spec", title: "A", status: "draft" },
      root,
    );
    const before = readFileSync(join(root, "a.md"), "utf8");
    const bodyBefore = before.slice(before.indexOf("---\n", 4) + 4);

    const updated = await run(
      SPEC_UPDATE_TOOL_NAME,
      { id: "a", set: { status: "active" }, addList: { tags: ["x"] } },
      root,
    );
    expect(updated).toBe("Updated frontmatter of a.md (id: a).");

    const after = readFileSync(join(root, "a.md"), "utf8");
    expect(after).toContain("status: active");
    expect(after).toContain("tags: [x]");
    expect(after.endsWith(bodyBefore)).toBe(true);

    const renamed = await run(SPEC_UPDATE_TOOL_NAME, { id: "a", set: { id: "b" } }, root);
    expect(renamed).toBe("Error: Cannot rename a spec's id via set.");

    const missing = await run(SPEC_UPDATE_TOOL_NAME, { id: "nope", set: { status: "done" } }, root);
    expect(missing).toBe('Error: No spec with id "nope".');

    // 删掉被引用的兄弟：下一次 spec_validate 必须报出这条悬挂链。
    await run(
      SPEC_CREATE_TOOL_NAME,
      { path: "b.md", id: "b", type: "task-spec", title: "B", dependsOn: ["a"] },
      root,
    );
    expect(await run(SPEC_DELETE_TOOL_NAME, { id: "a" }, root)).toBe("Deleted a.md (id: a).");
    const report = await run(SPEC_VALIDATE_TOOL_NAME, {}, root);
    expect(report).toContain("Dangling links (1):");
    expect(report).toContain("b (b.md) --depends-on--> a [missing]");
  });

  it("seeds the workspace scratch dir with a gitignore when a spec lands in it", async () => {
    const root = tempWorkspace();
    const created = await run(
      SPEC_CREATE_TOOL_NAME,
      {
        path: ".zcode-thinkrail/context/draft.md",
        id: "draft",
        type: "task-spec",
        title: "Draft",
      },
      root,
    );
    expect(created).toBe("Created .zcode-thinkrail/context/draft.md (id: draft).");
    expect(readFileSync(join(root, ".zcode-thinkrail/context/.gitignore"), "utf8")).toBe("*\n");
  });

  it("reports an invalid search pattern as tool text, not as a thrown error", async () => {
    const root = tempWorkspace();
    const output = await run(SPEC_GREP_TOOL_NAME, { pattern: "([", regex: true }, root);
    expect(output).toMatch(/^Error: Invalid search pattern/);
  });
});
