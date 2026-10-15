import { describe, expect, it } from "vitest";
import type { SkillMetadata } from "@zcode/contracts";
import { buildSkillsSection } from "../src/context/sections/skills.js";

const skill = (
  name: string,
  invocationCount = 0,
  description = `Use ${name} for a matching request.`,
): SkillMetadata => ({
  name,
  invocationCount,
  description,
  path: `/very/long/install/root/${name}/SKILL.md`,
  directory: `/very/long/install/root/${name}`,
  rootPath: "/very/long/install/root",
  source: "user",
  scope: "user",
  safeToAutoLoad: true,
  frontmatterKeys: ["name", "description"],
});
const outcome = (skills: SkillMetadata[]) => ({
  skills,
  diagnostics: [],
  totalDiscovered: skills.length,
});

describe("Claude-compatible skill matching catalog", () => {
  it("removes individual low-use descriptions while keeping every name and the most-used trigger", () => {
    const section = buildSkillsSection({
      outcome: outcome([
        skill("a-cold", 0, "Cold ".repeat(100)),
        skill("choosing-a-workflow", 12, "Use FIRST when any new piece of work arrives."),
        skill("z-cold", 1, "Cold ".repeat(100)),
      ]),
      metadataBudget: 500,
    });
    expect(section?.content).toContain("- a-cold\n");
    expect(section?.content).toContain("- z-cold");
    expect(section?.content).toContain("choosing-a-workflow: Use FIRST");
    expect(section?.content).not.toContain("/very/long/install/root");
    expect(section?.content.length).toBeLessThanOrEqual(500);
  });
  it("derives the budget from the actual model context capacity", () => {
    const skills = [skill("a", 10, "a".repeat(900)), skill("z", 0, "z".repeat(900))];
    const small = buildSkillsSection({ outcome: outcome(skills), contextWindow: 20_000 });
    const large = buildSkillsSection({ outcome: outcome(skills), contextWindow: 200_000 });
    expect(small?.content).not.toContain("z: ");
    expect(large?.content).toContain("z: ");
  });
  it("caps combined descriptions at 1536 characters, keeping the start of when_to_use", () => {
    const entry = { ...skill("long", 0, "x".repeat(1200)), whenToUse: "WHEN " + "y".repeat(500) };
    const section = buildSkillsSection({ outcome: outcome([entry]), metadataBudget: 10_000 });
    const line = section!.content.split("\n").find((value) => value.startsWith("- long: "))!;
    expect(line.slice("- long: ".length).length).toBe(1536);
    expect(line).toContain("WHEN");
  });
  it("excludes skills whose policy forbids model invocation", () => {
    const disabled = { ...skill("manual-only"), policy: { allowImplicitInvocation: false } };
    expect(buildSkillsSection({ outcome: outcome([disabled]) })).toBeNull();
  });
  it("preserves all names even when names alone exceed the configured budget", () => {
    const section = buildSkillsSection({
      outcome: outcome([skill("a"), skill("z")]),
      metadataBudget: 1,
    });
    expect(section?.content).toContain("- a");
    expect(section?.content).toContain("- z");
    expect(section?.content).not.toContain("a: ");
  });
  it("rejects invalid budget fractions and description limits", () => {
    expect(() =>
      buildSkillsSection({ outcome: outcome([skill("a")]), listingBudgetFraction: -1 }),
    ).toThrow();
    expect(() =>
      buildSkillsSection({ outcome: outcome([skill("a")]), maxDescriptionChars: 0 }),
    ).toThrow();
  });
});
