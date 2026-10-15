import { describe, expect, it, vi } from "vitest";
import type { NativeAgentRequest } from "@zcode/contracts";
import type { query } from "@anthropic-ai/claude-agent-sdk/core";
import { ClaudeAgentKernel } from "../src/agent-kernel/claude.js";

const request = (
  skillListingPolicy?: NativeAgentRequest["skillListingPolicy"],
): NativeAgentRequest => ({
  prompt: "inspect",
  cwd: "/tmp",
  mode: "default",
  planEnabled: false,
  appendSystemPrompt: "",
  pluginRoots: [],
  tools: [],
  signal: new AbortController().signal,
  onEvent: async () => {},
  requestPermission: async () => ({ allowed: false }),
  skillListingPolicy,
});

describe("Claude native skill catalog policy", () => {
  it.each([8_000, 40_000, 0])(
    "passes the admitted character budget %s and description cap without inheriting external CLI policy",
    async (characterBudget) => {
      const runQuery = vi.fn(() =>
        Object.assign(
          (async function* () {
            yield {
              type: "result",
              subtype: "success",
              is_error: false,
              result: "done",
              session_id: "native-policy",
            };
          })(),
          { close: vi.fn() },
        ),
      );
      const kernel = new ClaudeAgentKernel({
        query: runQuery as unknown as typeof query,
        resolveConnection: () => ({ model: "custom-model", apiKey: "fixture" }),
        env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: "999999" },
      });
      await kernel.run(request({ characterBudget, maxDescriptionChars: 800 }));
      const options = (
        runQuery.mock.calls as unknown as [{ options: Parameters<typeof query>[0]["options"] }][]
      )[0]![0].options!;
      expect(options.model).toBe("custom-model");
      expect(options.env?.SLASH_COMMAND_TOOL_CHAR_BUDGET).toBe(String(characterBudget));
      const settings =
        typeof options.settings === "string" ? JSON.parse(options.settings) : options.settings;
      expect(settings).toMatchObject({ skillListingMaxDescChars: 800 });
      expect(options.settingSources).toEqual(["project", "local"]);
    },
  );
});
