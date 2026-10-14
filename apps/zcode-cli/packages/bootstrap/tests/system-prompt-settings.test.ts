import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelMessageContentToText, type ModelRequest } from "@zcode/contracts";
import { expect, it } from "vitest";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

const systemMessages = (request: ModelRequest) =>
  request.messages
    .filter((message) => message.role === "system")
    .map((message) => modelMessageContentToText(message.content));

it("设置正文保存/恢复后更新实际请求，ThinkRail 与其他注入保留，查询不调用模型", async () => {
  const root = await mkdtemp(join(tmpdir(), "system-prompt-settings-"));
  let mainSystemPrompt: string | undefined;
  const requests: ModelRequest[] = [];
  const app = await createRegistryBackedTestApp({
    env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
    skipUserConfig: true,
    readThinkrailEnabled: () => true,
    readMainSystemPrompt: () => mainSystemPrompt,
    runtimeConfig: {
      workingDirectory: root,
      mode: "yolo",
      presentationSurface: "zcode_desktop",
      mcp: { enabled: false, servers: {} },
    },
    modelExecutor: {
      async generateText(request) {
        requests.push(request);
        return { finishReason: "stop", text: "done", usage: {} };
      },
    },
  });
  try {
    const initial = await app.getSystemPromptInspection();
    expect(requests).toHaveLength(0);
    expect(initial.sections.find((section) => section.source === "thinkrail")?.content).toContain(
      "choosing-a-workflow",
    );
    expect(initial.lastRequest).toBeUndefined();
    mainSystemPrompt = "CUSTOM MAIN INSTRUCTIONS";
    await app.submitPrompt("Inspect the project");
    const after = await app.getSystemPromptInspection();
    expect(after.basePrompt).toBe(mainSystemPrompt);
    expect(after.sections.find((section) => section.source === "thinkrail")?.readOnly).toBe(true);
    expect(after.sections.find((section) => section.source === "desktop_context")?.readOnly).toBe(
      true,
    );
    expect(after.lastRequest?.systemMessages).toEqual(systemMessages(requests[0]!));
    expect(systemMessages(requests[0]!).join("\n")).toContain(mainSystemPrompt);
    mainSystemPrompt = undefined;
    await app.submitPrompt("Continue");
    const restored = await app.getSystemPromptInspection();
    expect(restored.basePrompt).toBe(initial.basePrompt);
    expect(systemMessages(requests[1]!).join("\n")).not.toContain("CUSTOM MAIN INSTRUCTIONS");
    expect(systemMessages(requests[1]!).join("\n")).toContain("choosing-a-workflow");
    expect(restored.lastRequest?.systemMessages).toEqual(systemMessages(requests[1]!));
    expect(requests).toHaveLength(2);
  } finally {
    await app.close?.();
    await rm(root, { recursive: true, force: true });
  }
});

it("执行中保存保持本轮冻结，排队输入执行时采用新正文，历史不会被查询覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "system-prompt-admission-"));
  let mainSystemPrompt = "FIRST MAIN INSTRUCTIONS";
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const requests: ModelRequest[] = [];
  const app = await createRegistryBackedTestApp({
    env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
    skipUserConfig: true,
    readMainSystemPrompt: () => mainSystemPrompt,
    readThinkrailEnabled: () => true,
    runtimeConfig: { workingDirectory: root, mode: "yolo", mcp: { enabled: false, servers: {} } },
    modelExecutor: {
      async generateText(request) {
        requests.push(request);
        if (requests.length === 1) {
          entered();
          await gate;
        }
        return { finishReason: "stop", text: "done", usage: {} };
      },
    },
  });
  try {
    const first = app.submitPrompt("First input");
    await firstEntered;
    mainSystemPrompt = "SECOND MAIN INSTRUCTIONS";
    const during = await app.getSystemPromptInspection();
    expect(during.busy).toBe(true);
    expect(during.basePrompt).toBe("FIRST MAIN INSTRUCTIONS");
    expect(during.lastRequest?.systemMessages).toEqual(systemMessages(requests[0]!));
    const queued = app.submitPrompt("Queued input");
    release();
    await Promise.all([first, queued]);
    expect(requests).toHaveLength(2);
    expect(systemMessages(requests[1]!).join("\n")).toContain("SECOND MAIN INSTRUCTIONS");
    expect(systemMessages(requests[1]!).join("\n")).not.toContain("FIRST MAIN INSTRUCTIONS");
    expect(systemMessages(requests[1]!).join("\n")).toContain("choosing-a-workflow");
    const userMessages = JSON.stringify(
      requests[1]!.messages.filter((message) => message.role === "user"),
    );
    expect(userMessages).toContain("First input");
    expect(userMessages).toContain("Queued input");
  } finally {
    release();
    await app.close?.();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["workflow", "subagent"])("%s 的专用身份不被主智能体设置覆盖", async (kind) => {
  const root = await mkdtemp(join(tmpdir(), "system-prompt-scope-"));
  const requests: ModelRequest[] = [];
  const app = await createRegistryBackedTestApp({
    env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
    skipUserConfig: true,
    readMainSystemPrompt: () => "GLOBAL MAIN ONLY",
    runtimeConfig: {
      workingDirectory: root,
      mode: "yolo",
      mcp: { enabled: false, servers: {} },
      ...(kind === "workflow"
        ? { workflowActor: { name: "worker", persona: "WORKFLOW PERSONA" } }
        : {
            mainSystemPrompt: "GLOBAL MAIN ONLY",
            systemPrompt: "CHILD PERSONA",
            subagentContext: { agentPrompt: "CHILD PERSONA" },
          }),
    },
    modelExecutor: {
      async generateText(request) {
        requests.push(request);
        return { finishReason: "stop", text: "done", usage: {} };
      },
    },
  });
  try {
    await app.submitPrompt("Execute");
    const body = systemMessages(requests[0]!).join("\n");
    expect(body).not.toContain("GLOBAL MAIN ONLY");
    expect(body).toContain(kind === "workflow" ? "WORKFLOW PERSONA" : "CHILD PERSONA");
  } finally {
    await app.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
