import { beforeEach, expect, it, vi } from "vitest";
import type { ISubagentsService } from "@zcode/services";
import type { AgentsListResult } from "@zcode/shared";
import { useSubagentsContextStore, getSubagentsContextKey } from "@/store/subagentsContextStore.js";
import { useThinkrailCatalogStore } from "@/store/thinkrailCatalogStore.js";

function deferred() {
  let resolve!: (value: AgentsListResult) => void;
  const promise = new Promise<AgentsListResult>((settle) => {
    resolve = settle;
  });
  return { resolve, promise };
}
const result = (name: string): AgentsListResult => ({
  agents: [
    {
      id: name,
      name,
      description: name,
      systemPrompt: "",
      path: `built-in:${name}`,
      source: "built-in",
      scope: "built-in",
      enabled: true,
      readOnly: true,
    },
  ],
  userAgents: [],
  pluginAgents: [],
  capability: { userScopeAvailable: true },
});
beforeEach(() => {
  useSubagentsContextStore.setState({ contexts: {} });
  useThinkrailCatalogStore.setState({ revision: 0 });
});

it("开关确认使已缓存目录重新加载，关闭后迟到的旧名单不能恢复预设", async () => {
  const previous = deferred();
  const current = deferred();
  const list = vi.fn().mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const service = { list } as unknown as ISubagentsService;
  const state = useSubagentsContextStore.getState();
  const oldLoad = state.initialize("/same-path", "glm", service, "left-identity");
  useThinkrailCatalogStore.getState().invalidate();
  const newLoad = state.initialize("/same-path", "glm", service, "left-identity");
  expect(list).toHaveBeenCalledTimes(2);
  current.resolve(result("general-purpose"));
  await newLoad;
  previous.resolve(result("fixer"));
  await oldLoad;
  const key = getSubagentsContextKey("/same-path", "glm", "left-identity");
  expect(
    useSubagentsContextStore.getState().contexts[key]?.agents.map((agent) => agent.name),
  ).toEqual(["general-purpose"]);
  expect(useSubagentsContextStore.getState().contexts[key]?.catalogRevision).toBe(1);
  await state.initialize("/same-path", "glm", service, "left-identity");
  expect(list).toHaveBeenCalledTimes(2);
});
