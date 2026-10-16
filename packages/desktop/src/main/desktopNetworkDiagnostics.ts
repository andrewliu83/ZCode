import type { NetworkObservation } from "@zcode/rpc";
import {
  flushInterfaceNetworkStats,
  recordNetworkObservation,
  resetNetworkTelemetryAggregator,
} from "./networkTelemetryAggregator.js";
import { desktopRuntimeEnv } from "./desktopRuntimeEnv.js";

/** 仅写本地聚合日志；不记录请求正文、URL、设备身份，也不发送网络请求。 */
export const NETWORK_DIAGNOSTIC_INTERVAL_MS =
  desktopRuntimeEnv === "development" ? 60_000 : 300_000;
interface NetworkLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}
let diagnosticTimer: ReturnType<typeof setInterval> | null = null;

export function ingestHostNetworkObservations(observations: NetworkObservation[]): void {
  for (const observation of observations) recordNetworkObservation(observation);
}

export const WEB_REMOTE_RELAY_INTERFACE = "web_remote_control.relay";
export function noteWebRemoteRelayConnectAttempt(
  durationMs: number,
  ok: boolean,
  options?: { error?: unknown; attempt?: number },
): void {
  recordNetworkObservation({
    transport: "websocket",
    interface: WEB_REMOTE_RELAY_INTERFACE,
    durationMs: Math.max(0, Math.round(durationMs)),
    ok,
    errorKind: ok ? undefined : classifyWsError(options?.error),
    attempt: options?.attempt ?? 1,
  });
}
export function noteWebRemoteRelayReconnect(): void {
  recordNetworkObservation({
    transport: "websocket",
    interface: WEB_REMOTE_RELAY_INTERFACE,
    durationMs: 0,
    ok: false,
    errorKind: "connection_reset",
    attempt: 2,
  });
}
function classifyWsError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("dns") || message.includes("getaddrinfo")) return "dns_failure";
  return "connection_reset";
}
export function registerDesktopNetworkDiagnostics(logger: NetworkLogger): void {
  stopDesktopNetworkDiagnostics();
  resetNetworkTelemetryAggregator();
  diagnosticTimer = setInterval(() => {
    try {
      for (const stats of flushInterfaceNetworkStats()) {
        logger.info("[network] local aggregate", stats);
      }
    } catch (error) {
      logger.warn("[network] local aggregate failed:", error);
    }
  }, NETWORK_DIAGNOSTIC_INTERVAL_MS);
  diagnosticTimer.unref?.();
}
export function stopDesktopNetworkDiagnostics(): void {
  if (diagnosticTimer) clearInterval(diagnosticTimer);
  diagnosticTimer = null;
}
