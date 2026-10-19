import { randomUUID } from "node:crypto";
import { chmod, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRequestLine, serializeResponse } from "./broker.js";

const MAX_MESSAGE_BYTES = 1024 * 1024;

/**
 * Host 对外的稳定兼容 socket：只承载状态查询、原生连接代次发现和进程调度。
 * 原生 endpoint 每次代次都不同，这里保持逻辑地址不变，Agent 侧凭据在重启后仍然有效。
 */
export async function createCompatibilityTransport({ backend, timeoutMs }) {
  const directory = await mkdtemp(join(tmpdir(), "zcua-"));
  await chmod(directory, 0o700);
  const socketPath = join(directory, "broker.sock");
  const sockets = new Set();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      const index = buffer.indexOf("\n");
      if (index < 0 || handled) return;
      handled = true;
      void handleRequestLine(backend, buffer.slice(0, index))
        .then((reply) => {
          if (!socket.destroyed) socket.end(serializeResponse(reply));
        })
        .catch(() => socket.destroy());
    });
    socket.setTimeout(timeoutMs + 5000, () => socket.destroy());
  });
  try {
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    listener.close();
    throw error;
  }
  return {
    directory,
    socketPath,
    transport: { socketPath, pluginAuthority: randomUUID() },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => listener.close(resolve));
    },
  };
}
