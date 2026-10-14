import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecGraphSnapshot } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";

export interface SpecGraphState {
  snapshot: SpecGraphSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface ScopedSpecGraphState {
  scope: object | null;
  value: Omit<SpecGraphState, "refresh">;
}

const EMPTY_SCOPED_STATE: ScopedSpecGraphState = {
  scope: null,
  value: { snapshot: null, loading: false, error: null },
};

/**
 * spec 图面板的数据源。
 *
 * 与 `useSkills` 同一形状，理由是同一类问题：面板可能属于**另一个**工作区（本地或远端），
 * 所以经 `useWorkspaceServicesResolution` 解析出正确的 service 集合，而不是直接用当前上下文
 * 的 `useServices()` —— 后者在远端工作区会读到本机文件系统。
 *
 * 两个刻意的选择：
 *
 * - **不自动轮询**。快照每次现算，面板是用户主动打开的只读视图；后台轮询会把一次仓库遍历
 *   变成每秒一次。手动刷新（refresh）与工作区切换时的重读已经覆盖真实用法。
 * - **按 scope 身份隔离渲染**。切换工作区时旧快照在 effect 尚未执行的一帧里不能泄漏到新面板
 *   —— 那一帧显示的是上一个仓库的 spec。
 */
export function useSpecGraph(options: {
  workspacePath: string;
  workspaceIdentity?: string;
  enabled: boolean;
}): SpecGraphState {
  const resolution = useWorkspaceServicesResolution(
    options.workspacePath,
    null,
    options.workspaceIdentity,
  );
  const [scopedState, setScopedState] = useState<ScopedSpecGraphState>(EMPTY_SCOPED_STATE);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestSeqRef = useRef(0);
  const workspaceKey = options.workspaceIdentity?.trim() || options.workspacePath;
  const services = resolution.services;
  const rpcReady = resolution.rpcReady;
  const requestKey = `${workspaceKey}|remote:${resolution.remoteSessionId ?? "local"}|refresh:${refreshToken}`;

  const requestScope = useMemo(() => ({}), [options.enabled, requestKey, rpcReady, services]);

  useEffect(() => {
    if (!options.enabled || !options.workspacePath || !rpcReady) return;
    const seq = ++requestSeqRef.current;
    let cancelled = false;
    setScopedState({ scope: requestScope, value: { snapshot: null, loading: true, error: null } });
    services.specGraphService
      .readSnapshot({
        workspacePath: options.workspacePath,
        ...(options.workspaceIdentity ? { workspaceIdentity: options.workspaceIdentity } : {}),
      })
      .then((snapshot) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setScopedState({ scope: requestScope, value: { snapshot, loading: false, error: null } });
      })
      .catch((error: unknown) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[useSpecGraph] 读取 spec 图失败", { error: message, requestKey });
        setScopedState({
          scope: requestScope,
          value: { snapshot: null, loading: false, error: message },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    options.enabled,
    options.workspacePath,
    options.workspaceIdentity,
    requestKey,
    requestScope,
    rpcReady,
    services,
  ]);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  const value =
    scopedState.scope === requestScope
      ? scopedState.value
      : { snapshot: null, loading: options.enabled, error: null };

  return { ...value, refresh };
}
