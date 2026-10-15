import { expect, it } from "vitest";
import { createSqliteSessionStore } from "../src/storage/index.js";
import {
  createMessageId,
  createPartId,
  createProjectId,
  createSessionId,
  createToolCallId,
} from "@zcode/contracts";

it("skill frequency counts successful canonical identities once per tool call", async () => {
  const store = createSqliteSessionStore({ dbPath: ":memory:" });
  const sessionID = createSessionId();
  const messageID = createMessageId();
  const now = Date.now();
  try {
    await store.createSession({
      id: sessionID,
      projectID: createProjectId(),
      slug: "skills",
      directory: "/tmp",
      path: "/tmp",
      title: "skills",
      version: "test",
      time: { created: now, updated: now },
    });
    await store.saveMessage({
      id: messageID,
      sessionID,
      role: "user",
      time: { created: now },
      agent: "test",
    });
    const callID = createToolCallId();
    for (const [index, status] of ["completed", "completed", "error", "running"].entries()) {
      await store.savePart({
        id: createPartId(),
        sessionID,
        messageID,
        type: "tool",
        callID: index < 2 ? callID : createToolCallId(),
        tool: "Skill",
        state:
          status === "completed"
            ? {
                status,
                input: { skill: "alias" },
                output: "loaded",
                title: "Skill",
                metadata: { skill: { name: "router", qualifiedName: "plugin:router" } },
                time: { start: now, end: now },
              }
            : status === "error"
              ? {
                  status,
                  input: { skill: "alias" },
                  error: "failed",
                  time: { start: now, end: now },
                }
              : { status: "running", input: { skill: "alias" }, time: { start: now } },
      });
    }
    expect(await store.getSkillInvocationCounts?.()).toEqual({ "plugin:router": 1 });
  } finally {
    await store.close();
  }
});
