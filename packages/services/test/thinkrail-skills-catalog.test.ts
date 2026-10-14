import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ZCodeSkillReferenceCatalogEntry } from "@zcode/shared";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("技能设置目录复用 Agent 内置项，支持查看和引用且拒绝单独启停、复制和删除", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-skills-service-"));
  roots.push(root);
  vi.stubEnv("HOME", root);
  vi.resetModules();
  const { createSkillsService } = await import("../src/skills/skillsService.js");
  const directory = join(root, "bundled", "choosing-a-workflow");
  const path = join(directory, "SKILL.md");
  await mkdir(directory, { recursive: true });
  const content = "---\nname: choosing-a-workflow\ndescription: Router\n---\nWORKFLOW_ROUTER_BODY";
  await writeFile(path, content);
  const entry: ZCodeSkillReferenceCatalogEntry = {
    id: `glm:built-in:${path}`,
    name: "choosing-a-workflow",
    description: "Router",
    path,
    scope: "built-in",
    enabled: true,
    readOnly: true,
  };
  let enabled = true;
  const readBuiltInSkills = vi.fn(async () => (enabled ? [entry] : []));
  const service = createSkillsService({ isDesktopRuntime: true, readBuiltInSkills });
  const params = { workspacePath: root, workspaceIdentity: "test-identity" };
  expect((await service.list(params)).skills).toContainEqual(
    expect.objectContaining({
      ...entry,
      body: "WORKFLOW_ROUTER_BODY",
      readOnly: true,
    }),
  );
  expect(readBuiltInSkills).toHaveBeenCalledWith(expect.objectContaining(params));
  expect(
    (await service.buildPromptContext({ ...params, prompt: "$choosing-a-workflow" })).prompt,
  ).toContain("WORKFLOW_ROUTER_BODY");
  await expect(
    service.setEnabled({ ...params, skillId: entry.id, enabled: false }),
  ).rejects.toThrow("不能单独启停");
  await expect(service.copyToCommon({ ...params, skillId: entry.id })).rejects.toThrow("只读");
  await expect(service.deleteSkill({ ...params, skillId: entry.id })).rejects.toThrow("只读");
  expect(await readFile(path, "utf8")).toBe(content);
  enabled = false;
  expect((await service.list(params)).skills).toEqual([]);
});
