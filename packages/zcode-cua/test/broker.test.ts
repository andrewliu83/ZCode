import { createServer, type Server } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  callBrokerMethod,
  dispatchRequest,
  mintBrokerSocketPath,
  parseRequestLine,
  probeHelperHealth,
  resolveBrokerSocketPath,
} from "../broker.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serve(reply: (line: string) => string | undefined): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cua-rpc-"));
  const path = join(dir, "broker.sock");
  const server: Server = createServer((socket) => {
    socket.on("error", () => {});
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes("\n")) return;
      const response = reply(buffer.slice(0, buffer.indexOf("\n")));
      if (response) {
        socket.write(response.slice(0, 7));
        socket.end(response.slice(7));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  return path;
}

describe("CUA compatibility broker", () => {
  it("derives stable isolated rendezvous paths and honors explicit paths", () => {
    const options = { env: { ZCODE_HOME: "/profiles/a" } };
    expect(resolveBrokerSocketPath(options)).toBe(resolveBrokerSocketPath(options));
    expect(resolveBrokerSocketPath(options)).not.toBe(
      resolveBrokerSocketPath({ env: { ZCODE_HOME: "/profiles/b" } }),
    );
    expect(
      resolveBrokerSocketPath({ env: { ZCODE_CUA_PERMISSION_BROKER_SOCKET: "/explicit.sock" } }),
    ).toBe("/explicit.sock");
    expect(mintBrokerSocketPath()).not.toBe(mintBrokerSocketPath());
  });

  it("parses numeric legacy ping IDs and rejects invalid or prototype method calls", async () => {
    expect(parseRequestLine('{"id":0,"method":"ping","params":{}}')).toEqual({
      id: 0,
      method: "ping",
      params: {},
    });
    expect(parseRequestLine("[]")).toBeUndefined();
    expect(parseRequestLine("bad json")).toBeUndefined();
    const result = await dispatchRequest({}, { method: "constructor" });
    expect(result.ok).toBe(false);
  });

  it("reassembles JSONL replies and returns only their result", async () => {
    const path = await serve((line) => {
      const request = JSON.parse(line);
      expect(request.method).toBe("get_driver_connection");
      return `${JSON.stringify({ id: request.id, ok: true, result: { generation: "g1", socketPath: "/driver" } })}\n`;
    });
    await expect(
      callBrokerMethod({ socketPath: path, method: "get_driver_connection" }),
    ).resolves.toEqual({ generation: "g1", socketPath: "/driver" });
  });

  it("preserves permission errors without retries", async () => {
    let attempts = 0;
    const path = await serve(() => {
      attempts += 1;
      return '{"ok":false,"error":{"code":"permission_denied","message":"Missing Accessibility"}}\n';
    });
    await expect(
      callBrokerMethod({ socketPath: path, method: "permission_status" }),
    ).rejects.toMatchObject({ code: "permission_denied", message: "Missing Accessibility" });
    expect(attempts).toBe(1);
  });

  it("times out silent peers and rejects malformed responses", async () => {
    const silent = await serve(() => undefined);
    await expect(
      callBrokerMethod({ socketPath: silent, method: "ping", timeoutMs: 25 }),
    ).rejects.toMatchObject({ code: "timeout" });
    const malformed = await serve(() => "not json\n");
    await expect(callBrokerMethod({ socketPath: malformed, method: "ping" })).rejects.toMatchObject(
      { code: "invalid_response" },
    );
  });

  it("reports actual daemon identity and rejects empty successful health", async () => {
    const healthy = await serve(
      () => '{"ok":true,"result":{"bundleId":"ai.cua.driver","pid":123}}\n',
    );
    await expect(probeHelperHealth(healthy, { timeoutMs: 100 })).resolves.toEqual({
      bundleId: "ai.cua.driver",
      pid: 123,
    });
    const empty = await serve(() => '{"ok":true,"result":{}}\n');
    await expect(
      probeHelperHealth(empty, { timeoutMs: 25, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(Error);
  });
});
