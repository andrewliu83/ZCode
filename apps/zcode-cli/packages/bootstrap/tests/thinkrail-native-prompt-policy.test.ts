import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { NativeAgentKernelPort, NativeAgentRequest } from "@zcode/contracts";
import { formatClaudeSystemPromptExtension } from "@zcode/adapters/agent-kernel";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

it("Claude 已有代码但无 spec 时也注入 spec 规则，已有会话下一轮按开关同步", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-native-spec-rule-"));
  let enabled = false;
  const requests: NativeAgentRequest[] = [];
  const nativeId = "663c9d0f-c5ff-433c-a977-8db9ec04bd17";
  const kernel: NativeAgentKernelPort = {
    formatSystemPromptExtension: formatClaudeSystemPromptExtension,
    run: async (request) => {
      requests.push(request);
      await request.onEvent({ type: "session", sessionId: nativeId });
      await request.onEvent({
        type: "text",
        messageId: `native-${requests.length}`,
        delta: "done",
      });
      return { sessionId: nativeId, response: "done" };
    },
  };
  let app: Awaited<ReturnType<typeof createRegistryBackedTestApp>> | undefined;
  try {
    await writeFile(join(root, "index.ts"), "export const existingCode = true;\n");
    app = await createRegistryBackedTestApp({
      env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
      skipUserConfig: true,
      readThinkrailEnabled: () => enabled,
      nativeAgentKernel: kernel,
      runtimeConfig: {
        workingDirectory: root,
        agentKernel: "claude",
        mode: "yolo",
        mcp: { enabled: false, servers: {} },
      },
      modelExecutor: {
        generateText: async () => {
          throw new Error("ZCode loop must not run");
        },
      },
    });
    for (const value of [false, true, false]) {
      enabled = value;
      await app.submitPrompt("熟悉当前项目");
      const request = requests.at(-1)!;
      expect(request.appendSystemPrompt.includes("Specs are this project's ground truth.")).toBe(
        value,
      );
      expect(
        request.appendSystemPrompt.includes("read the thinkrail:choosing-a-workflow skill FIRST"),
      ).toBe(value);
      expect(request.appendSystemPrompt.includes("mcp__zcode_thinkrail__spec_graph")).toBe(value);
      expect(request.tools.some((tool) => tool.name === "spec_graph")).toBe(value);
      expect(request.skillListingPolicy).toEqual({
        characterBudget: 40_000,
        maxDescriptionChars: 1536,
      });
      expect(
        request.appendSystemPrompt.includes("Existing code without a spec graph takes priority"),
      ).toBe(value);
      expect(request.appendSystemPrompt.includes('<preloaded_skill name="spec-graph">')).toBe(
        value,
      );
      expect(request.appendSystemPrompt).not.toContain("/skills/thinkrail:choosing-a-workflow");
      const inspection = await app.getSystemPromptInspection();
      expect(inspection.nativeKernel).toBe("claude");
      const section = inspection.sections.find((section) => section.source === "thinkrail");
      expect(Boolean(section?.content.includes("Specs are this project's ground truth."))).toBe(
        value,
      );
      if (value) {
        expect(section?.readOnly).toBe(true);
        expect(request.appendSystemPrompt).toContain("re-check the route after spec discovery");
      }
    }
    expect(requests).toHaveLength(3);
    expect(requests[1]?.resumeSessionId).toBe(nativeId);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
