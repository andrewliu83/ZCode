import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { ZodError } from "zod";
import {
  runWithModelInvocationContext,
  type Model,
  type ModelInvocationContext,
} from "@zcode/contracts";
import { nativeMessagesSchema, toGatewayModelRequest } from "./model-gateway-request.js";
import { gatewayMessage, gatewayStream } from "./model-gateway-response.js";

const MAX_BODY_BYTES = 24 * 1024 * 1024;
export interface NativeModelGatewayLease {
  baseUrl: string;
  apiKey: string;
  close(): Promise<void>;
}
class GatewayRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES)
      throw new GatewayRequestError(413, "Model request exceeds the gateway body limit");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayRequestError(400, "Invalid model request JSON");
  }
}
function authorized(request: IncomingMessage, token: string): boolean {
  const raw =
    request.headers["x-api-key"] ?? request.headers.authorization?.replace(/^Bearer\s+/u, "");
  if (typeof raw !== "string") return false;
  const bytes = Buffer.from(raw);
  const expected = Buffer.from(token);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}
function sendError(response: ServerResponse, error: unknown): void {
  const status =
    error instanceof GatewayRequestError ? error.status : error instanceof ZodError ? 400 : 502;
  // 原始 provider error 可能包含凭据和请求；由 Model 现有日志/观测保留，不转给 SDK 子进程。
  const validation =
    error instanceof ZodError
      ? error.issues
          .slice(0, 6)
          .map(
            (issue) =>
              `${issue.path.join(".") || "request"}: ${issue.code}${issue.code === "unrecognized_keys" ? ` (${issue.keys.join(", ")})` : ""}`,
          )
          .join("; ")
      : undefined;
  const message =
    error instanceof GatewayRequestError
      ? error.message
      : status === 400
        ? `Unsupported or invalid model request: ${validation}`
        : "The configured upstream model request failed";
  const body = {
    type: "error",
    error: {
      type:
        status === 401
          ? "authentication_error"
          : status === 400
            ? "invalid_request_error"
            : "api_error",
      message,
    },
  };
  if (response.headersSent) response.end(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
  else {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

/** 原生内核只得到短期 loopback token；所有上游凭据、代理、重试仍归现有 Model。 */
export async function createNativeModelGateway(input: {
  models: ReadonlyMap<string, Model>;
  signal: AbortSignal;
  invocationContext?: ModelInvocationContext;
}): Promise<NativeModelGatewayLease> {
  input.signal.throwIfAborted();
  const apiKey = randomBytes(32).toString("hex");
  const leaseAbort = new AbortController();
  const parentAbort = () => leaseAbort.abort(input.signal.reason);
  input.signal.addEventListener("abort", parentAbort, { once: true });
  const server = createServer((request, response) => {
    void (async () => {
      if (!authorized(request, apiKey))
        throw new GatewayRequestError(401, "Invalid model gateway authorization");
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (
        request.method !== "POST" ||
        !["/v1/messages", "/v1/messages/count_tokens"].includes(path)
      )
        throw new GatewayRequestError(404, "Unknown model gateway endpoint");
      if (path.endsWith("count_tokens"))
        throw new GatewayRequestError(
          501,
          "This upstream does not provide exact Anthropic token counts",
        );
      const body = nativeMessagesSchema.parse(await readBody(request));
      const model = input.models.get(body.model);
      if (!model)
        throw new GatewayRequestError(400, "The requested model is outside this execution lease");
      const disconnected = new AbortController();
      const onClose = () => {
        if (!response.writableEnded) disconnected.abort(new Error("SDK model connection closed"));
      };
      response.once("close", onClose);
      const signal = AbortSignal.any([leaseAbort.signal, disconnected.signal]);
      try {
        let modelRequest: import("@zcode/contracts").ModelRequest;
        try {
          modelRequest = toGatewayModelRequest(body, signal);
        } catch {
          throw new GatewayRequestError(400, "Unsupported model gateway content or tool options");
        }
        const cap = model.optionSpecs.maxOutputTokens.max;
        if (
          cap !== undefined &&
          modelRequest.options?.maxOutputTokens &&
          modelRequest.options.maxOutputTokens > cap
        )
          modelRequest.options.maxOutputTokens = cap;
        if (body.stream) {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          });
          const consume = async () => {
            for await (const event of gatewayStream(model, modelRequest, body.model)) {
              if (!response.write(event)) await once(response, "drain", { signal });
            }
          };
          // AsyncLocalStorage 必须覆盖迭代过程；只包装 generator 创建会丢掉账号鉴权/trace/admission。
          if (input.invocationContext)
            await runWithModelInvocationContext(input.invocationContext, consume);
          else await consume();
          response.end();
        } else {
          const generate = () => model.generateText(modelRequest);
          const result = input.invocationContext
            ? await runWithModelInvocationContext(input.invocationContext, generate)
            : await generate();
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(gatewayMessage(result, body.model)));
        }
      } finally {
        response.off("close", onClose);
      }
    })().catch((error) => {
      if (!response.destroyed) sendError(response, error);
    });
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    input.signal.removeEventListener("abort", parentAbort);
    leaseAbort.abort(new Error("Model gateway lease closed"));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          ? reject(error)
          : resolve(),
      );
    });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    input.signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Model gateway did not bind a loopback port");
    return { apiKey, baseUrl: `http://127.0.0.1:${address.port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
