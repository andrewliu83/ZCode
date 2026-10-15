import { expect, it } from "vitest";
import { nativeAgentProfiles } from "../src/runtime/methods/native-agent-profiles.js";
import type { AgentProfile } from "@zcode/shared";

it("native built-ins and plugin aliases do not become duplicate SDK agent entities", () => {
  const plugin: AgentProfile = {
    name: "documents:visual-judge",
    source: "user",
    path: "/fixture/documents/agents/visual-judge.md",
    description: "Judge",
    systemPrompt: "Read only",
    tools: ["Read"],
  };
  const user: AgentProfile = {
    name: "explorer",
    source: "user",
    path: "/fixture/user/explorer.md",
    description: "Custom",
    systemPrompt: "USER",
    tools: ["Read"],
  };
  const agents = nativeAgentProfiles(
    [
      { name: "Explore", source: "built-in", description: "Explore", systemPrompt: "builtin" },
      plugin,
      { ...plugin, name: "visual-judge" },
      user,
    ],
    ["general-purpose", "Explore"],
  );
  expect(Object.keys(agents!)).toEqual(["documents:visual-judge", "explorer"]);
  expect(agents!.explorer).toMatchObject({ prompt: "USER", tools: ["Read"] });
});
