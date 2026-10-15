import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRequest } from "@zcode/contracts";
import { expect, it } from "vitest";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

const systemText = (request: ModelRequest) =>
  JSON.stringify(request.messages.filter((message) => message.role === "system"));
const toolNames = (request: ModelRequest) => request.tools?.map((tool) => tool.name) ?? [];

it("已有会话在下一轮同步 spec 开关，无 spec 时实际模型请求仍包含两条常驻规则", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-prompt-policy-"));
  let enabled = false;
  let shouldReadRouter = false;
  const requests: ModelRequest[] = [];
  let app: Awaited<ReturnType<typeof createRegistryBackedTestApp>> | undefined;
  try {
    const knownRoot = join(root, ".zcode", "skills", "known-user-skill");
    await mkdir(knownRoot, { recursive: true });
    await writeFile(
      join(knownRoot, "SKILL.md"),
      "---\nname: known-user-skill\ndescription: Known user skill\n---\nKNOWN",
    );
    app = await createRegistryBackedTestApp({
      env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
      skipUserConfig: true,
      readThinkrailEnabled: () => enabled,
      runtimeConfig: {
        workingDirectory: root,
        mode: "yolo",
        mcp: { enabled: false, servers: {} },
        runtimeFeatures: { thinkrail: false },
      },
      modelExecutor: {
        async generateText(request) {
          requests.push(request);
          if (shouldReadRouter) {
            shouldReadRouter = false;
            return {
              finishReason: "tool-calls",
              text: "",
              usage: {},
              toolCalls: [
                { id: "workflow-router", name: "Skill", input: { skill: "choosing-a-workflow" } },
              ],
            };
          }
          return { finishReason: "stop", text: "done", usage: {} };
        },
      },
    });
    await writeFile(join(root, "index.ts"), "export const existingCode = true;\n");
    for (const value of [false, true, false]) {
      enabled = value;
      shouldReadRouter = value;
      await app.submitPrompt("熟悉当前项目");
      const request = requests.at(-1)!;
      expect(systemText(request).includes("read the choosing-a-workflow skill FIRST")).toBe(value);
      expect(systemText(request).includes("Specs are this project's ground truth.")).toBe(value);
      expect(toolNames(request).includes("spec_grep")).toBe(value);
      if (value)
        expect(
          JSON.stringify(request.messages.filter((message) => message.role === "tool")),
        ).toContain("# Choosing a Workflow");
      const catalog = await app.getSkillCatalog();
      expect(catalog.skills.some((skill) => skill.name === "choosing-a-workflow")).toBe(value);
      expect(catalog.skills.some((skill) => skill.name === "known-user-skill")).toBe(true);
      expect(catalog.skills.some((skill) => skill.name === "late-user-skill")).toBe(false);
      const lateRoot = join(root, ".zcode", "skills", "late-user-skill");
      await mkdir(lateRoot, { recursive: true });
      await writeFile(
        join(lateRoot, "SKILL.md"),
        "---\nname: late-user-skill\ndescription: Late user skill\n---\nLATE",
      );
    }
    expect(
      requests.at(-1)?.messages.filter((message) => message.role === "user").length,
    ).toBeGreaterThanOrEqual(3);
  } finally {
    await app?.close?.();
    await rm(root, { recursive: true, force: true });
  }
});

it("running 时的开关更新保持本轮冻结，排队输入执行时采用新值", async () => {
  const root = await mkdtemp(join(tmpdir(), "thinkrail-queued-policy-"));
  let enabled = true;
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let enterFirst!: () => void;
  const entered = new Promise<void>((resolve) => {
    enterFirst = resolve;
  });
  const requests: ModelRequest[] = [];
  let app: Awaited<ReturnType<typeof createRegistryBackedTestApp>> | undefined;
  try {
    app = await createRegistryBackedTestApp({
      env: { HOME: root, ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: join(root, "db.sqlite") },
      skipUserConfig: true,
      readThinkrailEnabled: () => enabled,
      runtimeConfig: {
        workingDirectory: root,
        mode: "yolo",
        mcp: { enabled: false, servers: {} },
        runtimeFeatures: { thinkrail: true },
      },
      modelExecutor: {
        async generateText(request) {
          requests.push(request);
          if (requests.length === 1) {
            enterFirst();
            await gate;
          }
          return { finishReason: "stop", text: "done", usage: {} };
        },
      },
    });
    const first = app.submitPrompt("熟悉当前项目");
    await entered;
    enabled = false;
    expect(
      (await app.getSkillCatalog()).skills.some((skill) => skill.name === "choosing-a-workflow"),
    ).toBe(true);
    const queued = app.submitPrompt("继续解释项目");
    releaseFirst();
    await Promise.all([first, queued]);
    expect(requests).toHaveLength(2);
    expect(systemText(requests[0]!)).toContain("read the choosing-a-workflow skill FIRST");
    expect(systemText(requests[1]!)).not.toContain("read the choosing-a-workflow skill FIRST");
    expect(toolNames(requests[1]!)).not.toContain("spec_grep");
  } finally {
    releaseFirst();
    await app?.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
