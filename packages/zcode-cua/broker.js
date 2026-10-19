import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";
const MAX_MESSAGE_BYTES = 1024 * 1024;
const METHODS = new Set([
  "ping",
  "permission_status",
  "get_driver_connection",
  "screen_capture_probe",
  "screen_recording_preflight",
  "health_report",
]);

export class BrokerError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use broker is unavailable.");
    this.name = "BrokerError";
    this.code = options.code ?? "unavailable";
    if (options.details !== undefined) this.details = options.details;
  }
}

export class CuaHelperError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use Helper is unavailable.");
    this.name = "CuaHelperError";
    this.code = options.code ?? "helper_unavailable";
  }
}

export function isCuaHelperError(value) {
  return value instanceof CuaHelperError;
}

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });
export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

export async function callBrokerMethod({ socketPath, method, params, timeoutMs = 30_000, signal }) {
  if (!socketPath || !isBrokerMethod(method)) {
    throw new BrokerError("Invalid Computer Use broker request.", { code: "invalid_request" });
  }
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const id = randomUUID();
    let buffer = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new BrokerError("Computer Use broker timed out.", {
            code: "timeout",
          }),
        ),
      Math.max(1, timeoutMs),
    );
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`),
    );
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        finish(
          new BrokerError("Computer Use broker response exceeds the limit.", {
            code: "invalid_response",
          }),
        );
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline));
        if (!reply || typeof reply.ok !== "boolean" || (reply.id != null && reply.id !== id)) {
          throw new Error("Invalid response envelope");
        }
        if (reply.ok) finish(undefined, reply.result);
        else
          finish(
            new BrokerError(reply.error?.message ?? "Computer Use broker failed.", {
              code: reply.error?.code ?? "unavailable",
              details: reply.error?.details,
            }),
          );
      } catch (error) {
        finish(
          new BrokerError(error instanceof Error ? error.message : String(error), {
            code: "invalid_response",
          }),
        );
      }
    });
    socket.once("error", (error) =>
      finish(new BrokerError(error.message, { code: "helper_unavailable" })),
    );
    socket.once("end", () =>
      finish(
        new BrokerError("Computer Use broker closed before replying.", {
          code: "invalid_response",
        }),
      ),
    );
    if (signal?.aborted) abort();
  });
}

export async function probeHelperHealth(socketPath, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 3000);
  let lastError;
  do {
    try {
      const result = await callBrokerMethod({
        socketPath,
        method: "ping",
        timeoutMs: Math.max(1, Math.min(options.perTryTimeoutMs ?? 500, deadline - Date.now())),
      });
      if (!Number.isSafeInteger(result?.pid) || result.pid <= 0) {
        throw new CuaHelperError("Computer Use health did not identify its process.");
      }
      return {
        bundleId: typeof result.bundleId === "string" ? result.bundleId : null,
        pid: result.pid,
      };
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(options.pollIntervalMs ?? 100, remaining));
  } while (Date.now() < deadline);
  throw lastError ?? new CuaHelperError("Computer Use health probe timed out.");
}

function socketAt(name, dir = tmpdir()) {
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(dir, `${name}.sock`);
}

export function mintBrokerSocketPath(options = {}) {
  return socketAt(`zcode-cua-${randomUUID()}`, options.dir);
}

export function resolveBrokerSocketPath(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = env[BROKER_SOCKET_ENV]?.trim();
  if (fromEnv) return fromEnv;
  // 稳定发现地址按用户配置根隔离，随机地址只用于显式创建私有实例。
  const identity = env.ZCODE_HOME?.trim() || env.HOME?.trim() || homedir();
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  return socketAt(`zcode-cua-${digest}`, options.dir);
}

export function parseRequestLine(line) {
  if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) return undefined;
  try {
    const request = JSON.parse(line);
    if (
      !request ||
      Array.isArray(request) ||
      typeof request !== "object" ||
      typeof request.method !== "string" ||
      !isBrokerMethod(request.method) ||
      (request.id != null && typeof request.id !== "string" && typeof request.id !== "number")
    )
      return undefined;
    return request;
  } catch {
    return undefined;
  }
}

export function okResponse(result) {
  return { ok: true, result };
}

export function errorResponse(message, options = {}) {
  return { ok: false, error: { message, ...(options.code ? { code: options.code } : {}) } };
}

export function errorResponseFromException(error) {
  return errorResponse(error instanceof Error ? error.message : String(error), {
    code: typeof error?.code === "string" ? error.code : "internal",
  });
}

export function serializeResponse(response) {
  return `${JSON.stringify(response)}\n`;
}

export async function dispatchRequest(backend, request) {
  const handler =
    isBrokerMethod(request.method) && Object.hasOwn(backend, request.method)
      ? backend[request.method]
      : undefined;
  if (typeof handler !== "function")
    return errorResponse("Unknown Computer Use broker method.", { code: "invalid_request" });
  try {
    return {
      ...okResponse(await handler.call(backend, request.params ?? {})),
      ...(request.id != null ? { id: request.id } : {}),
    };
  } catch (error) {
    return {
      ...errorResponseFromException(error),
      ...(request.id != null ? { id: request.id } : {}),
    };
  }
}

export async function handleRequestLine(backend, line) {
  const request = parseRequestLine(line);
  return request
    ? await dispatchRequest(backend, request)
    : errorResponse("Invalid Computer Use request.", { code: "invalid_request" });
}

export function isBrokerMethod(method) {
  return METHODS.has(method);
}

export function isReadOnlyBrokerMethod(method) {
  return (
    method === "ping" ||
    method === "permission_status" ||
    method === "health_report" ||
    method === "screen_recording_preflight"
  );
}
