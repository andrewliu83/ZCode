import { useCallback, useEffect, useRef, useState } from "react";
import type { ZCodeSystemPromptReadResult } from "@zcode/shared";
import { useZCodeAgentService } from "./useZCodeAgentService.js";
import { useSystemPromptInspectionStore } from "@/store/systemPromptInspectionStore.js";
import { selectWorkspaceZCodeState, useZCodeSessionStore } from "@/store/zcodeSessionStore.js";

/** 只读取 UI 的当前选择；不把选择态当作 Runtime 配置或对话事实。 */
export function useCurrentPromptSession(
  workspacePath?: string | null,
  workspaceIdentity?: string | null,
): string | undefined {
  return useZCodeSessionStore((state) => {
    if (!workspacePath) return undefined;
    const workspace = selectWorkspaceZCodeState(
      state,
      workspacePath,
      workspaceIdentity ?? undefined,
    );
    return workspace.activeTaskId ?? undefined;
  });
}

export function useSystemPromptInspection(params: {
  workspacePath?: string | null;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  sessionId?: string;
  mainSystemPrompt?: string;
  thinkrailEnabled?: boolean;
}) {
  const {
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    sessionId,
    mainSystemPrompt,
    thinkrailEnabled,
  } = params;
  const service = useZCodeAgentService(
    workspacePath ?? undefined,
    remoteSessionId,
    workspaceIdentity,
  );
  const targetKey = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    remoteSessionId,
    sessionId,
  ]);
  const revision = useSystemPromptInspectionStore((state) => state.revision);
  const generation = useRef(0);
  const [state, setState] = useState<{
    key: string;
    service: typeof service | null;
    snapshot: ZCodeSystemPromptReadResult | null;
    loading: boolean;
    error: unknown;
  }>({ key: "", service: null, snapshot: null, loading: false, error: null });
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!workspacePath) {
      setState({ key: targetKey, service, snapshot: null, loading: false, error: null });
      return;
    }
    setState((previous) => ({
      key: targetKey,
      service,
      snapshot:
        previous.key === targetKey && previous.service === service ? previous.snapshot : null,
      loading: true,
      error: null,
    }));
    try {
      const snapshot = await service.getSystemPromptSnapshot({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
        ...(sessionId ? { sessionId } : {}),
      });
      // 原因：相同路径可以属于不同远程身份；迟到结果不能覆盖新目标的提示词。
      if (generation.current === request)
        setState({ key: targetKey, service, snapshot, loading: false, error: null });
    } catch (error) {
      if (generation.current === request)
        setState({ key: targetKey, service, snapshot: null, loading: false, error });
    }
  }, [remoteSessionId, service, sessionId, targetKey, workspaceIdentity, workspacePath]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, mainSystemPrompt, revision, thinkrailEnabled]);
  return {
    ...(state.key === targetKey && state.service === service
      ? state
      : { snapshot: null, loading: Boolean(workspacePath), error: null }),
    refresh,
  };
}
