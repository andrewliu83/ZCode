import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { NativeAgentKernelPort } from "@zcode/contracts";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

it.each(["claude", "fixture-agent"])(
  "cold restore follows the persisted %s binding instead of the changed default",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "zcode-sdk-resume-"));
    const nativeId = "663c9d0f-c5ff-433c-a977-8db9ec04bd17";
    const resumed: Array<string | undefined> = [];
    let app: Awaited<ReturnType<typeof createRegistryBackedTestApp>> | undefined;
    const kernel: NativeAgentKernelPort = {
      run: async (request) => {
        resumed.push(request.resumeSessionId);
        await request.onEvent({ type: "session", sessionId: nativeId, model: "test" });
        await request.onEvent({
          type: "text",
          messageId: `native-${resumed.length}`,
          delta: "done",
        });
        return {
          sessionId: nativeId,
          response: "done",
          usage: { inputTokens: 5, outputTokens: 2 },
        };
      },
    };
    const common = {
      env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
      skipUserConfig: true,
      nativeAgentKernel: kernel,
      agentKernelRegistrations: [
        {
          descriptor: {
            id: "fixture-agent",
            label: "Fixture",
            execution: "native" as const,
            prompt: "managed-preset" as const,
          },
          create: () => kernel,
        },
      ],
      modelExecutor: {
        generateText: async () => {
          throw new Error("ZCode loop must not run");
        },
      },
    };
    try {
      app = await createRegistryBackedTestApp({
        ...common,
        runtimeConfig: {
          workingDirectory: root,
          agentKernel: kind,
          mode: "yolo",
          mcp: { enabled: false, servers: {} },
        },
      });
      await app.submitPrompt("one");
      const sessionId = app.sessionId;
      await app.close();
      app = undefined;
      app = await createRegistryBackedTestApp({
        ...common,
        sessionId,
        resume: true,
        runtimeConfig: {
          workingDirectory: root,
          agentKernel: "zcode",
          mode: "yolo",
          mcp: { enabled: false, servers: {} },
        },
      });
      await app.submitPrompt("two");
      expect(resumed).toEqual([undefined, nativeId]);
      const db = new DatabaseSync(join(root, "db.sqlite"), { readOnly: true });
      try {
        const rows = db
          .prepare(
            "select data from message where session_id = ? and json_extract(data, '$.role') = 'assistant'",
          )
          .all(sessionId) as { data: string }[];
        const messages = rows.map((row) => JSON.parse(row.data));
        expect(messages).toHaveLength(2);
        expect(messages.every((message) => message.time.completed >= message.time.created)).toBe(
          true,
        );
        expect(messages.reduce((sum, message) => sum + message.tokens.output, 0)).toBe(4);
        expect(messages.every((message) => message.providerId !== "claude-code")).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
