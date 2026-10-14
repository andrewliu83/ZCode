import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRequest } from "@zcode/contracts";
import type { SubagentRuntimeConfig } from "@zcode/shared";
import { expect, it, vi } from "vitest";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

it("ThinkRail 每轮刷新保留同名用户 fixer 的新提示词与只读工具白名单", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-agent-overrides-"));
  const hostConfig = (prompt: string): SubagentRuntimeConfig => ({
    kind: "ready",
    profiles: [
      {
        name: "fixer",
        description: "Custom restricted fixer",
        source: "user",
        path: join(root, "agents", "fixer.md"),
        systemPrompt: prompt,
        tools: ["Read"],
      },
    ],
    builtInModelSelectionOverrides: {},
    pluginAgentModelSelectionOverrides: {},
  });
  const readHost = vi.fn(async () => hostConfig("TR_INITIAL_PROFILE"));
  const childRequests: ModelRequest[] = [];
  let parentCalls = 0;
  let app: Awaited<ReturnType<typeof createRegistryBackedTestApp>> | undefined;
  try {
    app = await createRegistryBackedTestApp({
      env: { ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
      skipUserConfig: true,
      runtimeConfig: {
        workingDirectory: root,
        mode: "yolo",
        mcp: { enabled: false, servers: {} },
        runtimeFeatures: { thinkrail: true },
      },
      readSubagentRuntimeConfig: readHost,
      modelExecutor: {
        async generateText(request) {
          const isChild = JSON.stringify(request.messages).includes("_PROFILE");
          if (isChild) childRequests.push(request);
          return !isChild && ++parentCalls === 1
            ? {
                finishReason: "tool-calls",
                text: "",
                usage: {},
                toolCalls: [
                  {
                    id: "restricted_fixer",
                    name: "Agent",
                    input: { description: "Review", prompt: "Review", subagent_type: "fixer" },
                  },
                ],
              }
            : { finishReason: "stop", text: "done", usage: {} };
        },
      },
    });
    readHost.mockResolvedValue(hostConfig("TR_NEXT_PROFILE"));
    await app.submitPrompt("Delegate a read-only review to fixer");
    expect(childRequests).toHaveLength(1);
    expect(JSON.stringify(childRequests[0]?.messages)).toContain("TR_NEXT_PROFILE");
    const toolNames = childRequests[0]?.tools?.map((tool) => tool.name) ?? [];
    expect(toolNames).toContain("Read");
    for (const name of ["Write", "Edit", "Bash"]) expect(toolNames).not.toContain(name);
    expect(readHost).toHaveBeenCalledTimes(2);
  } finally {
    await app?.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
