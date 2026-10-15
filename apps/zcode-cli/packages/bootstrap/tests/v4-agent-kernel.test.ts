import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { NativeAgentKernelPort } from "@zcode/contracts";
import {
  V4_METHODS,
  conversationTopic,
  reassembleTopicWireFrames,
  routedTopicWireFrameSchema,
  routedTopicFrameSchema,
} from "@zcode/shared/zcode-protocol-v4";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";
import {
  createRegistryBackedTestApp,
  createTestProviderRegistry,
} from "./helpers/registry-backed-test-app.js";

it.each(
  ["desktop-continuous", "web-remote-replayable"].flatMap((clientMode) =>
    ["claude", "fixture-agent"].map((kernel) => ({ clientMode, kernel })),
  ),
)(
  "$clientMode 显式选择 $kernel 会创建对应 Runtime，首发进入注册内核而不是 ZCode 循环",
  async ({ clientMode, kernel }) => {
    const root = await mkdtemp(join(tmpdir(), "v4-kernel-choice-"));
    const nativeRun = vi.fn<NativeAgentKernelPort["run"]>(async (request) => {
      await request.onEvent({ type: "session", sessionId: "663c9d0f-c5ff-433c-a977-8db9ec04bd17" });
      await request.onEvent({ type: "text", messageId: "native-message", delta: "SDK complete" });
      return { sessionId: "663c9d0f-c5ff-433c-a977-8db9ec04bd17", response: "SDK complete" };
    });
    const generateText = vi.fn(async () => {
      throw new Error("ZCode model loop must not execute");
    });
    const apps: Awaited<ReturnType<typeof createRegistryBackedTestApp>>[] = [];
    const server = new ZCodeProtocolAgentServer({
      cwd: root,
      version: "test",
      env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
      createZCodeApp: async (options) => {
        const app = await createRegistryBackedTestApp({
          ...options,
          providerRegistry: createTestProviderRegistry([
            { providerId: "kernel-test", modelId: "model-2" },
          ]),
          skipUserConfig: true,
          nativeAgentKernel: { run: nativeRun },
          agentKernelRegistrations: [
            {
              descriptor: {
                id: "fixture-agent",
                label: "Fixture",
                execution: "native",
                prompt: "managed-preset",
              },
              create: () => ({ run: nativeRun }),
            },
          ],
          modelExecutor: { generateText },
          runtimeConfig: {
            ...options.runtimeConfig,
            workingDirectory: root,
            mcp: { enabled: false, servers: {} },
          },
        });
        apps.push(app);
        return app;
      },
    });
    const request = async (id: string, method: string, params: unknown) => {
      const response = await server.handleMessage({ id, method, params });
      if (!response || "error" in response || !("result" in response))
        throw new Error(JSON.stringify(response));
      return response.result as any;
    };
    try {
      const created = await request("create", V4_METHODS.command, {
        commandId: "kernel-create",
        clientId: "test-client",
        issuedAt: Date.now(),
        sessionId: null,
        type: "createSession",
        payload: {
          workspaceId: root,
          agentKernel: kernel,
          persistence: "immediate",
          config: {
            provider: "kernel-test",
            model: "model-2",
            mode: "build",
            planEnabled: false,
            followupMode: "queue",
          },
        },
      });
      expect(created.status).toBe("accepted");
      expect(created.result.agentKernel).toBe(kernel);
      const entries = await apps[0]!.runtime.sessionStore!.sessionEntries!({
        sessionID: created.result.sessionId,
        type: "agent_kernel",
      });
      expect(entries.some((entry) => (entry.data as { kernel?: string }).kernel === kernel)).toBe(
        true,
      );
      const sessionId = created.result.sessionId;
      await request("subscribe", V4_METHODS.conversationSubscribe, {
        topic: conversationTopic(sessionId),
        connectionId: "test-connection",
        clientMode,
      });
      const messages = server.takePostResponseMessages("subscribe");
      const frames = messages.map((message) => routedTopicWireFrameSchema.parse(message.params));
      const initial = reassembleTopicWireFrames(frames, routedTopicFrameSchema);
      expect(JSON.stringify(initial)).toContain(`"agentKernel":"${kernel}"`);
      const sent = await request("send", V4_METHODS.command, {
        commandId: "kernel-send",
        clientId: "test-client",
        issuedAt: Date.now(),
        sessionId,
        type: "sendText",
        payload: { text: "hello", agentKernel: kernel },
      });
      expect(sent.status).toBe("accepted");
      await vi.waitFor(() => expect(nativeRun).toHaveBeenCalledOnce());
      expect(generateText).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
      for (const app of apps) await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
