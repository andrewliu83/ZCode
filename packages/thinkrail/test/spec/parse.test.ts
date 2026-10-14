// spec frontmatter 方言测试 —— 对照 JetBrains/thinkrail 的 core 行为断言。
// 移植自 dsh-plugin-thinkrail 的 test/spec.test.js（MIT）。

import { describe, expect, it } from "vitest";

import {
  FIELDS,
  isSpec,
  parseFile,
  serializeFrontmatter,
  updateFrontmatterText,
  type FrontmatterUpdate,
  type SpecFrontmatter,
} from "../../src/spec/index.js";

function specText(frontmatter: string, body = "\n# Body\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function frontmatterOf(text: string): SpecFrontmatter {
  const { frontmatter } = parseFile(text);
  if (frontmatter === null) throw new Error("expected a parsed frontmatter");
  return frontmatter;
}

/** 取出一次成功改写的正文；失败结果直接抛错，让断言表述保持单一。 */
function updated(result: FrontmatterUpdate): string {
  if ("error" in result) throw new Error(`expected a rewrite, got: ${result.error}`);
  return result.content;
}

function failed(result: FrontmatterUpdate): string {
  if (!("error" in result)) throw new Error("expected an error result");
  return result.error;
}

describe("parse", () => {
  it("treats a file with id + type as a spec", () => {
    const { frontmatter } = parseFile(specText("id: a\ntype: module-design\ntitle: A"));
    expect(isSpec(frontmatter)).toBe(true);
    expect(frontmatter?.id).toBe("a");
  });

  it("is not a spec without frontmatter, or with only one identity field", () => {
    expect(isSpec(parseFile("# hello\n").frontmatter)).toBe(false);
    expect(isSpec(parseFile(specText("id: a\ntitle: A")).frontmatter)).toBe(false);
    expect(isSpec(parseFile(specText("type: module-design")).frontmatter)).toBe(false);
  });

  it("returns a null frontmatter for invalid YAML and keeps the whole text as body", () => {
    const text = specText("id: [unclosed");
    const parsed = parseFile(text);
    expect(parsed.frontmatter).toBeNull();
    expect(parsed.body).toBe(text);
  });

  it("drops a BOM before the fence", () => {
    const { frontmatter } = parseFile(`\ufeff${specText("id: a\ntype: t\ntitle: A")}`);
    expect(frontmatter?.id).toBe("a");
  });

  it("reads inline and block lists the same way", () => {
    expect(frontmatterOf(specText("id: a\ntype: t\ntags: [x, y]")).tags).toEqual(["x", "y"]);
    expect(frontmatterOf(specText("id: a\ntype: t\ntags:\n  - x\n  - y")).tags).toEqual(["x", "y"]);
  });
});

describe("serializeFrontmatter", () => {
  it("writes the frontmatter block with inline lists", () => {
    const text = serializeFrontmatter({ id: "a", type: "module-design", tags: ["x", "y"] });
    expect(text).toBe("---\nid: a\ntype: module-design\ntags: [x, y]\n---\n");
  });

  it("writes an empty block for an empty frontmatter", () => {
    expect(serializeFrontmatter({})).toBe("---\n---\n");
  });
});

describe("updateFrontmatterText", () => {
  it("sets a scalar and leaves the body byte-identical", () => {
    const body = "\n# Title\n\nsome prose\n";
    const text = specText("id: a\ntype: t\ntitle: Old", body);
    const content = updated(updateFrontmatterText(text, { set: { title: "New" } }));
    expect(content).toMatch(/title: New/);
    expect(content.endsWith(body)).toBe(true);
  });

  it("preserves comments, field order, and unknown fields", () => {
    const text = specText(
      ["# leading comment", "title: T", "id: a", "custom: keep-me", "type: t"].join("\n"),
    );
    const content = updated(updateFrontmatterText(text, { set: { status: "active" } }));
    const lines = content.split("\n");
    expect(lines[1]).toBe("# leading comment");
    const order = ["title:", "id:", "custom:", "type:"].map((key) =>
      lines.findIndex((line) => line.startsWith(key)),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(lines).toContain("custom: keep-me");
    expect(lines).toContain("status: active");
  });

  it("preserves CRLF line endings", () => {
    const text = "---\r\nid: a\r\ntype: t\r\n---\r\nbody\r\n";
    const content = updated(updateFrontmatterText(text, { set: { title: "X" } }));
    expect(content).toContain("id: a\r\n");
    expect(/[^\r]\n/.test(content)).toBe(false);
  });

  it("adds and removes list entries, deduplicating on add", () => {
    const text = specText("id: a\ntype: t\ntags: [x]");
    const added = updated(updateFrontmatterText(text, { addList: { tags: ["x", "y"] } }));
    expect(added).toMatch(/tags: \[x, y\]/);
    const removed = updated(updateFrontmatterText(added, { removeList: { tags: ["x"] } }));
    expect(removed).toMatch(/tags: \[y\]/);
    const emptied = updated(updateFrontmatterText(removed, { removeList: { tags: ["y"] } }));
    expect(emptied).not.toMatch(/tags:/);
  });

  it("removes a scalar field", () => {
    const content = updated(
      updateFrontmatterText(specText("id: a\ntype: t\nstatus: stale"), { remove: ["status"] }),
    );
    expect(content).not.toMatch(/status:/);
  });

  it("refuses to rename the id, un-spec the file, or set a list field as a scalar", () => {
    const text = specText("id: a\ntype: t");
    expect(failed(updateFrontmatterText(text, { set: { id: "b" } }))).toMatch(/Cannot rename/);
    expect(failed(updateFrontmatterText(text, { remove: ["type"] }))).toMatch(/protected field/);
    expect(failed(updateFrontmatterText(text, { set: { tags: "x" } }))).toMatch(
      /addList\/removeList/,
    );
  });

  it("refuses a file with no frontmatter", () => {
    expect(failed(updateFrontmatterText("# no frontmatter\n", { set: { title: "x" } }))).toMatch(
      /no frontmatter/,
    );
  });
});

describe("FIELD constants", () => {
  it("keeps the upstream frontmatter vocabulary", () => {
    expect(FIELDS.dependsOn).toBe("depends-on");
    expect(FIELDS.references).toBe("references");
    expect(FIELDS.implements).toBe("implements");
  });
});
