import { describe, expect, it, vi } from "vitest";
import type { SkillContent, SkillLoadOutcome, SkillPort } from "@zcode/contracts";
import { preloadThinkrailSkills } from "../src/context/thinkrail-skills.js";
import { buildThinkrailSection } from "../src/context/sections/thinkrail.js";

const tools = ["Skill", "spec_grep", "spec_get", "spec_graph"];
function fixture() {
  const entries: SkillContent[] = ["choosing-a-workflow", "spec-graph"].map((name) => ({
    metadata: {
      name,
      description: "FIRST",
      path: `/bundle/skills/${name}/SKILL.md`,
      directory: `/bundle/skills/${name}`,
      rootPath: "/bundle/skills",
      scope: "system" as const,
      source: "bundled" as const,
      safeToAutoLoad: true,
      frontmatterKeys: [],
    },
    content:
      name === "choosing-a-workflow"
        ? "Existing code without a spec graph takes priority: setting-up-a-project"
        : "spec_grep pattern=. regex=true; nonexistent root is not an empty graph",
    baseDirectory: `/bundle/skills/${name}`,
    bytesRead: 100,
    sizeBytes: 100,
    truncated: false,
  }));
  const outcome: SkillLoadOutcome = {
    skills: entries.map((entry) => entry.metadata),
    diagnostics: [],
    totalDiscovered: 2,
  };
  const load = vi.fn(
    async ({ name }: { name: string }) => entries.find((entry) => entry.metadata.name === name)!,
  );
  const port: SkillPort = { discoverSkills: async () => outcome, loadSkill: load };
  const options = {
    enabled: true,
    toolNames: tools,
    outcome,
    port,
    workingDirectory: "/workspace",
  };
  return { entries, load, options };
}

describe("Runtime mandatory ThinkRail entry context", () => {
  it("loads trusted bundled roots even with a same-name user skill and renders full bodies independently of catalog budget", async () => {
    const f = fixture();
    const user = {
      ...f.entries[0]!.metadata,
      path: "/user/choosing/SKILL.md",
      source: "zcode" as const,
    };
    f.options.outcome.skills.unshift(user);
    const loaded = await preloadThinkrailSkills(f.options);
    expect(f.load).toHaveBeenCalledTimes(2);
    expect(f.load.mock.calls[0]![0]).toMatchObject({
      roots: [{ path: "/bundle/skills", source: "bundled" }],
    });
    const section = buildThinkrailSection({
      enabled: true,
      toolNames: tools,
      specRule: "SPEC",
      workflowRule: "WORKFLOW",
      preloadedSkills: loaded.preloadedSkills,
      formatRules: (text) => `MAPPED ${text}`,
    });
    expect(section?.content).toContain("MAPPED WORKFLOW");
    expect(section?.content).toContain("Existing code without a spec graph takes priority");
    expect(section?.content).toContain("regex=true");
    expect(section?.content).toContain(
      "Base directory for this skill: /bundle/skills/choosing-a-workflow",
    );
    expect(section?.content).not.toContain("/bundle/skills/MAPPED");
  });
  it.each([
    { enabled: false, toolNames: tools },
    { enabled: true, toolNames: ["Read"] },
  ])("clears old preloads when disabled or scope cannot use Skill: %j", async (gates) => {
    const f = fixture();
    const loaded = await preloadThinkrailSkills(f.options);
    const disabled = await preloadThinkrailSkills({ ...f.options, outcome: loaded, ...gates });
    expect(disabled.preloadedSkills).toEqual([]);
    expect(f.load).toHaveBeenCalledTimes(2);
  });
  it("does not load graph instructions into a scope without graph tools", async () => {
    const f = fixture();
    const loaded = await preloadThinkrailSkills({ ...f.options, toolNames: ["Skill"] });
    expect(loaded.preloadedSkills?.map((entry) => entry.metadata.name)).toEqual([
      "choosing-a-workflow",
    ]);
  });
  it.each([
    "truncated",
    "replaced",
    "renamed",
    "disabled-after-discovery",
    "unsafe",
    "empty",
    "missing",
    "denied",
  ])("fails instead of requesting a model with an invalid entry: %s", async (invalid) => {
    const f = fixture();
    if (invalid === "missing") f.options.outcome.skills = [];
    if (invalid === "denied")
      f.entries[0]!.metadata = {
        ...f.entries[0]!.metadata,
        policy: { allowImplicitInvocation: false },
      };
    if (invalid === "denied") f.options.outcome.skills = f.entries.map((entry) => entry.metadata);
    if (invalid === "truncated") f.entries[0]!.truncated = true;
    if (invalid === "empty") f.entries[0]!.content = " ";
    if (invalid === "replaced")
      f.load.mockImplementationOnce(async () => ({
        ...f.entries[0]!,
        metadata: { ...f.entries[0]!.metadata, path: "/outside/SKILL.md" },
      }));
    if (invalid === "renamed")
      f.load.mockImplementationOnce(async () => ({
        ...f.entries[0]!,
        metadata: { ...f.entries[0]!.metadata, name: "another-skill" },
      }));
    if (invalid === "disabled-after-discovery")
      f.load.mockImplementationOnce(async () => ({
        ...f.entries[0]!,
        metadata: { ...f.entries[0]!.metadata, policy: { allowImplicitInvocation: false } },
      }));
    if (invalid === "unsafe") f.entries[0]!.metadata.safeToAutoLoad = false;
    await expect(preloadThinkrailSkills(f.options)).rejects.toThrow(
      "Required ThinkRail entry skill",
    );
  });
  it("honors cancellation before reading assets", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      preloadThinkrailSkills({ ...f.options, signal: controller.signal }),
    ).rejects.toThrow();
    expect(f.load).not.toHaveBeenCalled();
  });
});
