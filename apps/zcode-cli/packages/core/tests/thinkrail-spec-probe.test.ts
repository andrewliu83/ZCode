import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { thinkrailHasSpec } from "../src/tool/handlers/thinkrail/shared.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("外部引入或删除 spec 后，下一次组装不继承旧的存在性结果", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-context-probe-"));
  roots.push(root);
  const specPath = join(root, "SPEC.md");
  expect(thinkrailHasSpec(root)).toBe(false);
  await writeFile(specPath, "---\nid: root\ntype: module-design\n---\n");
  expect(thinkrailHasSpec(root)).toBe(true);
  await rm(specPath);
  expect(thinkrailHasSpec(root)).toBe(false);
});
