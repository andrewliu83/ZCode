export interface ComputerUseRuntimeContext {
  sessionId: string;
  runtimeScope: "main" | "subagent";
  workspaceKey: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  clientMode?: "web-remote-replayable" | "desktop-continuous";
  deliveryKind?: "web-remote-replayable" | "desktop-continuous";
  trace?: Record<string, unknown>;
}

export interface ComputerUseRuntimeExecuteInput {
  toolName: string;
  arguments?: unknown;
  context: ComputerUseRuntimeContext;
  signal?: AbortSignal;
}

export interface ComputerUseRuntimeResult {
  content: Array<
    { type: "text"; text: string } | { type: "image"; mimeType: string; data: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface ComputerUseRuntime {
  execute(input: ComputerUseRuntimeExecuteInput): Promise<ComputerUseRuntimeResult>;
  closeSession(context: ComputerUseRuntimeContext): Promise<void>;
  dispose(): Promise<void>;
}

export interface ComputerUseRuntimeOptions {
  brokerSocketPath?: string;
  refreshMarkerPath?: string;
  ensureBrokerAvailable?: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

export declare function createComputerUseRuntime(
  options?: ComputerUseRuntimeOptions,
): ComputerUseRuntime;
