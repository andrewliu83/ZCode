import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { SkillLoadOutcome } from "@zcode/contracts";
import { zcodeSkillsReferenceCatalogResultSchema } from "@zcode/shared";
import { getSkillReferenceCatalog } from "../src/zcode-protocol/skill-reference-catalog.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";

it("新版入口提供只读内置技能，旧版入口仍保持原封闭 scope", async () => {
  const catalog: SkillLoadOutcome = {
    skills: [
      {
        name: "choosing-a-workflow",
        description: "Root workflow router",
        path: "/builtin/choosing-a-workflow/SKILL.md",
        directory: "/builtin/choosing-a-workflow",
        rootPath: "/builtin",
        scope: "system",
        source: "bundled",
        safeToAutoLoad: true,
        frontmatterKeys: ["name", "description"],
      },
    ],
    diagnostics: [],
    totalDiscovered: 1,
  };
  const context = {
    sessions: new Map([["session", { app: { getSkillCatalog: async () => catalog } }]]),
  } as unknown as ZCodeProtocolAgentServerContext;
  const params = {
    workspace: { workspacePath: "/workspace", workspaceKey: "/workspace" },
    sessionId: "session",
  };
  expect((await getSkillReferenceCatalog(context, params)).skills).toEqual([]);
  const result = await getSkillReferenceCatalog(context, params, true);
  expect(result.skills).toEqual([
    expect.objectContaining({ name: "choosing-a-workflow", scope: "built-in", readOnly: true }),
  ]);
  expect(() => zcodeSkillsReferenceCatalogResultSchema.parse(result)).not.toThrow();
});

it("草稿目录遵循进程开关，关闭后不能把随包 ThinkRail 技能放回目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-draft-catalog-"));
  try {
    for (const enabled of [true, false]) {
      const context = {
        deps: { env: { HOME: root, ZCODE_STORAGE_DIR: root } },
        sessions: new Map(),
        appRuntimePreferences: { thinkrailEnabled: enabled, dynamicWorkflowEnabled: false },
      } as unknown as ZCodeProtocolAgentServerContext;
      const result = await getSkillReferenceCatalog(
        context,
        { workspace: { workspacePath: root, workspaceKey: root } },
        true,
      );
      expect(result.skills.some((skill) => skill.name === "choosing-a-workflow")).toBe(enabled);
      expect(result.skills.some((skill) => skill.name === "dynamic-workflows")).toBe(false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
