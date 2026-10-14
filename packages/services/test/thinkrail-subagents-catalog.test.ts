import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createThinkrailAgentProfiles } from "@zcode/shared";
import { createSubagentsService } from "../src/subagents/subagentsService.js";
import { serializeSubagentMarkdown } from "../src/subagents/subagentMarkdown.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("开关控制设置和 @ 目录中的五个共享只读预设，同名用户配置仍优先", async () => {
  const home = await mkdtemp(join(tmpdir(), "thinkrail-subagents-catalog-"));
  roots.push(home);
  const workspacePath = join(home, "workspace");
  let enabled = true;
  const service = createSubagentsService({
    homeDir: home,
    isDesktopRuntime: true,
    isThinkrailEnabled: async () => enabled,
  });
  try {
    for (const mode of ["settingsUserOnly", "allRuntimeScopes"] as const) {
      const { agents } = await service.list({ workspacePath, mode });
      for (const preset of createThinkrailAgentProfiles()) {
        expect(agents).toContainEqual(
          expect.objectContaining({
            name: preset.name,
            tools: preset.tools,
            systemPrompt: preset.systemPrompt,
            scope: "built-in",
            source: "built-in",
            readOnly: true,
            enabled: true,
          }),
        );
      }
    }
    const userRoot = join(home, ".zcode", "agents");
    await mkdir(userRoot, { recursive: true });
    await writeFile(
      join(userRoot, "fixer.md"),
      serializeSubagentMarkdown({
        name: "fixer",
        description: "User restricted fixer",
        systemPrompt: "USER_FIXER",
        tools: ["Read"],
      }),
    );
    for (const value of [true, false]) {
      enabled = value;
      const { agents } = await service.list({ workspacePath });
      const fixer = agents.find((agent) => agent.name === "fixer");
      expect(fixer?.systemPrompt).toBe("USER_FIXER");
      expect(fixer?.tools).toEqual(["Read"]);
      expect(agents.some((agent) => agent.name === "code-reviewer")).toBe(value);
    }
  } finally {
    service.disposeAll();
  }
});
