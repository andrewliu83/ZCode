import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPluginAgentTemplates, resolvePluginAgentProfiles } from "../src/subagents.js";
import type { PluginMetadata } from "@zcode/contracts";

const families = ["documents", "pdf", "presentations", "spreadsheets"];

describe("official visual reviewer portability", () => {
  it.each(families)(
    "%s inherits the selected parent connection while user overrides stay explicit",
    async (name) => {
      const rootPath = resolve(import.meta.dirname, `../../${name}-plugin`);
      const plugin: PluginMetadata = {
        id: `${name}@zcode-plugins-official`,
        name,
        rootPath,
        enabled: true,
        manifestPath: "",
        dataPath: "",
        marketplace: "zcode-plugins-official",
        source: "cache",
        version: "0.1.9",
        components: [{ kind: "agent", items: [{ name: "visual-judge" }] }],
        commandRootCount: 0,
        declaredMcpServerNames: [],
        mcpServerNames: [],
        hookDetails: [],
        skillCount: 0,
        skillRootCount: 0,
      };
      const plugins = [plugin];
      const templates = loadPluginAgentTemplates({ plugins });
      expect(templates.diagnostics).toEqual([]);
      const inherited = resolvePluginAgentProfiles({ plugins }, templates);
      expect(inherited.profiles).toHaveLength(2);
      for (const profile of inherited.profiles) {
        expect(profile.modelSelection).toBeUndefined();
        expect(profile.tools).toEqual(["Read", "Bash"]);
      }
      const selection = {
        providerId: "custom:selected",
        modelId: "vision-model",
        options: { reasoningLevel: "high" },
      };
      const explicit = resolvePluginAgentProfiles(
        { plugins, modelSelectionOverrides: { [`plugin:${plugin.id}:visual-judge`]: selection } },
        templates,
      );
      expect(explicit.profiles.map((profile) => profile.modelSelection)).toEqual([
        selection,
        selection,
      ]);
      expect(await readFile(resolve(rootPath, "package.json"), "utf8")).toContain(
        '"version": "0.1.9"',
      );
    },
  );
});
