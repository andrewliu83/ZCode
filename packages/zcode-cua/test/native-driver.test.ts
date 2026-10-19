import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callBrokerMethod } from "../broker.js";
import { createProductCuaHelperHost } from "../broker-server.js";
import {
  createComputerUseRuntime,
  type ComputerUseRuntime,
  type ComputerUseRuntimeContext,
  type ComputerUseRuntimeResult,
} from "../index.js";

// Run from the repository root with Node 24:
// ZCODE_CUA_NATIVE_E2E=1 pnpm exec vitest run packages/zcode-cua/test/native-driver.test.ts
// Requires staged darwin-arm64 assets and Accessibility/Screen Recording grants for CuaDriver.app.
const enabled =
  process.platform === "darwin" &&
  process.arch === "arm64" &&
  process.env.ZCODE_CUA_NATIVE_E2E === "1";
const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(testDirectory, "../../..");
const title = "ZCode CUA native E2E fixture";
const prefix = "ZCODE_CUA_FIXTURE ";

type Element = { index: number; kind: string; title?: string; value?: string };
type State = {
  state_id: string;
  elements: Array<Element | null>;
  app: { pid: number };
  window: { window_id: number };
};
type Frame = { frame_id: string; width: number; height: number };
type Readback = { value: string; output: string; clicks: number };
type Connection = { generation: string; socketPath: string; pid: number };

function payload(result: ComputerUseRuntimeResult): Record<string, unknown> {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.find((block) => block.type === "text");
  return text?.type === "text" ? JSON.parse(text.text) : {};
}
function successful(result: ComputerUseRuntimeResult, operation: string) {
  if (result.isError) {
    const { code, message, action_sent, dispatch_status } = payload(result);
    throw new Error(
      `${operation}: ${JSON.stringify({ code, message, action_sent, dispatch_status })}`,
    );
  }
  return result;
}
function stateOf(result: ComputerUseRuntimeResult): State {
  const state = successful(result, "observe fixture").structuredContent as unknown as State;
  expect(typeof state?.state_id).toBe("string");
  expect(Array.isArray(state?.elements)).toBe(true);
  return state;
}
function element(state: State, kind: string, label?: string): Element {
  const found = state.elements.find(
    (item) => item?.kind === kind && (!label || item.title === label),
  );
  expect(Boolean(found), `Fixture ${kind} ${label ?? ""} is accessible`).toBe(true);
  return found!;
}
function screenshot(result: ComputerUseRuntimeResult): Frame {
  const image = result.content.find((block) => block.type === "image");
  expect(image?.type).toBe("image");
  if (image?.type !== "image") throw new Error("Fixture screenshot is missing");
  expect(image.mimeType).toBe("image/png");
  const png = Buffer.from(image.data, "base64");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBeGreaterThanOrEqual(600);
  expect(height).toBeGreaterThanOrEqual(300);
  const reference = result.content.find(
    (block) => block.type === "text" && block.text.startsWith('{"image_ref":'),
  );
  expect(Boolean(reference), "Fixture capture has actionable frame geometry").toBe(true);
  const frame =
    reference?.type === "text" ? (JSON.parse(reference.text).image_ref as Frame) : undefined;
  expect(frame?.width).toBe(width);
  expect(frame?.height).toBe(height);
  expect(typeof frame?.frame_id).toBe("string");
  expect(frame!.frame_id.length).toBeGreaterThan(0);
  return frame!;
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function fixture(directory: string) {
  const require = createRequire(join(root, "packages/desktop/package.json"));
  const electron: string = require("electron");
  const path = join(directory, "fixture.cjs");
  const html = `<!doctype html><html lang="en"><title>${title}</title><body>
    <h1>Isolated native driver fixture</h1>
    <label>Probe input <input id="probe" aria-label="Probe input"></label>
    <button id="apply" aria-label="Apply fixture">Apply fixture</button>
    <output id="result" aria-live="polite">initial</output>
    <script>
      const input = document.getElementById('probe');
      const output = document.getElementById('result');
      window.fixtureClicks = 0;
      document.getElementById('apply').addEventListener('click', () => {
        window.fixtureClicks += 1;
        output.textContent = input.value;
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') output.textContent = 'enter:' + input.value;
      });
    </script></body></html>`;
  // HTML 必须作为 JSON 字符串嵌入；原生 fixture 的多层引号不能靠手动转义。
  await writeFile(
    path,
    `const { app, BrowserWindow } = require('electron');
const { createInterface } = require('node:readline');
app.setPath('appData', ${JSON.stringify(directory)});
app.setPath('userData', ${JSON.stringify(join(directory, "user-data"))});
app.setAppLogsPath(${JSON.stringify(join(directory, "logs"))});
app.disableHardwareAcceleration();
const send = value => process.stdout.write(${JSON.stringify(prefix)} + JSON.stringify(value) + '\\n');
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  // Electron 就绪后再开启 AX，否则 input 不会出现在原生可访问树中。
  app.setAccessibilitySupportEnabled(true);
  const window = new BrowserWindow({ width: 640, height: 400, title: ${JSON.stringify(title)},
    show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(html)}));
  createInterface({ input: process.stdin }).on('line', async line => {
    const request = JSON.parse(line);
    try {
      const state = await window.webContents.executeJavaScript("({value: document.getElementById('probe').value, output: document.getElementById('result').textContent, clicks: window.fixtureClicks})");
      send({ id: request.id, state });
    } catch (error) { send({ id: request.id, error: error.message }); }
  });
  send({ ready: true, pid: process.pid, electron: process.versions.electron });
}).catch(error => { send({ error: error.message }); app.exit(1); });
`,
  );
  const child: ChildProcessWithoutNullStreams = spawn(electron, [path], {
    cwd: directory,
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  const pending = new Map<
    number,
    { resolve: (value: Readback) => void; reject: (error: Error) => void }
  >();
  let sequence = 0;
  let readiness: {
    resolve: (value: { pid: number; electron: string }) => void;
    reject: (error: Error) => void;
  };
  const ready = new Promise<{ pid: number; electron: string }>((resolve, reject) => {
    readiness = { resolve, reject };
  });
  const fail = (error: Error) => {
    readiness.reject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", fail);
  const exited = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      fail(new Error(`Fixture exited (${code ?? signal}): ${stderr}`));
      resolve();
    });
  });
  lines.on("line", (line) => {
    if (!line.startsWith(prefix)) return;
    const message = JSON.parse(line.slice(prefix.length));
    if (message.ready) readiness.resolve(message);
    else if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error));
      else request?.resolve(message.state);
    } else if (message.error) fail(new Error(message.error));
  });
  async function readback() {
    const id = ++sequence;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<Readback>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new Error("Fixture DOM readback timed out")), 5000);
        child.stdin.write(`${JSON.stringify({ id })}\n`);
      });
    } finally {
      clearTimeout(timer!);
      pending.delete(id);
    }
  }
  async function stop() {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      try {
        await expect.poll(() => alive(-child.pid!), { timeout: 5000 }).toBe(false);
      } finally {
        if (alive(-child.pid)) process.kill(-child.pid, "SIGKILL");
      }
    }
    await exited;
    lines.close();
  }
  const timer = setTimeout(() => fail(new Error(`Fixture startup timed out: ${stderr}`)), 15_000);
  try {
    const metadata = await ready;
    expect(metadata.pid).toBe(child.pid);
    expect(metadata.electron.split(".")[0]).toBe("41");
    return { pid: metadata.pid, readback, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!enabled)("native Cua Driver (opt-in, macOS arm64, Electron 41)", () => {
  it("round-trips only its fixture in desktop/mobile sessions and invalidates credentials on restart", async () => {
    const directory = await mkdtemp(join(testDirectory, ".native-driver-"));
    const assets = join(root, "packages/desktop/bundled-tools/cua-driver/darwin-arm64");
    const env = {
      ...process.env,
      ZCODE_CUA_DRIVER_SDK_PATH: join(assets, "node_modules/@trycua/cua-driver"),
      ZCODE_CUA_DRIVER_SOCKET_PATH: undefined,
    };
    const host = createProductCuaHelperHost({
      env,
      bundledHelperAppPath: join(assets, "CuaDriver.app"),
    });
    let nativeFixture: Awaited<ReturnType<typeof fixture>> | undefined;
    let runtime: ComputerUseRuntime | undefined;
    const driverPids = new Set<number>();
    try {
      nativeFixture = await fixture(directory);
      const transport = await host.waitForTransport();
      expect(host.running, "Reserving the broker must not launch the native driver").toBe(false);
      runtime = createComputerUseRuntime({ brokerSocketPath: transport.socketPath, env });
      expect(host.running, "Creating the runtime must remain lazy").toBe(false);
      const connection = async () => {
        const value = await callBrokerMethod<Connection>({
          socketPath: transport.socketPath,
          method: "get_driver_connection",
        });
        driverPids.add(value.pid);
        return value;
      };
      const evidence = [];
      for (const mode of ["desktop-continuous", "web-remote-replayable"] as const) {
        const context: ComputerUseRuntimeContext = {
          sessionId: `native-${mode}`,
          runtimeScope: "main",
          workspaceKey: directory,
          clientMode: mode,
          deliveryKind: mode,
          ...(mode === "web-remote-replayable" ? { remoteSessionId: "native-fixture-remote" } : {}),
        };
        const execute = (toolName: string, args: unknown = {}) =>
          runtime!.execute({ toolName, arguments: args, context });
        try {
          const permissions = await execute("request_access");
          await connection();
          expect(
            payload(permissions),
            "Opt-in native E2E requires Accessibility and Screen Recording grants for staged CuaDriver.app",
          ).toMatchObject({
            ready: true,
            accessibility: "granted",
            screenRecording: "granted",
          });
          successful(permissions, "native permissions");
          const windows = successful(
            await execute("list_windows", { app_ref: { pid: nativeFixture.pid } }),
            "list fixture windows",
          );
          const inventory = payload(windows) as unknown as Array<{
            title: string;
            pid: number;
            window_id: number;
          }>;
          const matches = inventory.filter(
            (window) => window.title === title && window.pid === nativeFixture!.pid,
          );
          expect(matches.length, "Exactly one window belongs to this fixture").toBe(1);
          const app_ref = { pid: nativeFixture.pid, window_id: matches[0].window_id };
          const observe = () => execute("get_app_state", { app_ref, include_screenshot: true });
          const target = (state: State, item: Element) => ({
            type: "element",
            index: item.index,
            state_id: state.state_id,
          });
          let observed = await observe();
          let state = stateOf(observed);
          expect(state.app.pid).toBe(nativeFixture.pid);
          expect(state.window.window_id).toBe(app_ref.window_id);
          screenshot(observed);
          let input = element(state, "AXTextField", "Probe input");
          const value = `set-${mode}`;
          state = stateOf(
            await execute("set_value", {
              app_ref,
              target: target(state, input),
              value,
              return_state: "full",
            }),
          );
          expect(element(state, "AXTextField", "Probe input").value).toBe(value);
          await expect.poll(async () => (await nativeFixture!.readback()).value).toBe(value);
          const beforeClick = await nativeFixture.readback();
          const button = element(state, "AXButton", "Apply fixture");
          state = stateOf(
            await execute("left_click", {
              app_ref,
              target: target(state, button),
              return_state: "full",
            }),
          );
          // 原生 effect 可能为 unverifiable；只以 fixture 的 DOM/AX 读回确认实际效果。
          await expect
            .poll(() => nativeFixture!.readback())
            .toEqual({ value, output: value, clicks: beforeClick.clicks + 1 });
          input = element(state, "AXTextField", "Probe input");
          // Electron 网页内容拒绝 AX 后台写入，但 Driver 支持先做后台像素聚焦再输入；
          // 适配层必须自动走这条真实后台路由并保持不抢焦点。
          const typed = `typed-${mode}`;
          // 像素聚焦依赖当前截图坐标；先清空字段，使 type 的追加语义可判定。
          state = stateOf(
            await execute("set_value", {
              app_ref,
              target: target(state, element(state, "AXTextField", "Probe input")),
              value: "",
              return_state: "full",
            }),
          );
          state = stateOf(await observe());
          const typedResult = await execute("type", {
            app_ref,
            target: target(state, element(state, "AXTextField", "Probe input")),
            text: typed,
          });
          expect(typedResult.isError, JSON.stringify(payload(typedResult))).not.toBe(true);
          await expect.poll(async () => (await nativeFixture!.readback()).value).toBe(typed);
          state = stateOf(await observe());
          stateOf(
            await execute("key", {
              app_ref,
              target: target(state, element(state, "AXTextField", "Probe input")),
              text: "Return",
              return_state: "full",
            }),
          );
          await expect
            .poll(async () => (await nativeFixture!.readback()).output)
            .toBe(`enter:${typed}`);

          observed = await observe();
          state = stateOf(observed);
          const oldElement = target(state, element(state, "AXTextField", "Probe input"));
          const oldFrame = screenshot(observed);
          const previous = await connection();
          await host.restartAfterCurrentStart();
          const next = await connection();
          expect(next.generation).not.toBe(previous.generation);
          expect(next.socketPath).not.toBe(previous.socketPath);
          expect(host.socketPath).toBe(transport.socketPath);
          const oldCoordinate = { type: "coordinate", frame_id: oldFrame.frame_id, x: 1, y: 1 };
          const rejected = async (tool: string, args: Record<string, unknown>) => {
            const result = await execute(tool, { app_ref, ...args });
            expect(result.isError).toBe(true);
            expect(payload(result)).toMatchObject({
              code: "element_unavailable",
              action_sent: false,
              dispatch_status: "not_sent",
            });
          };
          await rejected("set_value", { target: oldElement, value: "must-not-be-written" });
          await rejected("left_click", { target: oldCoordinate });
          observed = await observe();
          const fresh = stateOf(observed);
          expect(fresh.state_id).not.toBe(state.state_id);
          expect(screenshot(observed).frame_id).not.toBe(oldFrame.frame_id);
          await rejected("set_value", { target: oldElement, value: "must-not-be-written" });
          await rejected("left_click", { target: oldCoordinate });
          const restartedValue = `restart-${mode}`;
          successful(
            await execute("set_value", {
              app_ref,
              target: target(fresh, element(fresh, "AXTextField", "Probe input")),
              value: restartedValue,
            }),
            "fresh element after restart",
          );
          await expect
            .poll(async () => (await nativeFixture!.readback()).value)
            .toBe(restartedValue);
          evidence.push({
            mode,
            png: true,
            set: true,
            click: true,
            key: true,
            type: true,
            staleElement: true,
            staleFrame: true,
          });
        } finally {
          await runtime.closeSession(context);
        }
        const closed = await execute("list_windows", { app_ref: { pid: nativeFixture.pid } });
        expect(closed.isError).toBe(true);
        expect(payload(closed).action_sent).toBe(false);
      }
      expect(evidence.map(({ mode: _mode, ...checks }) => checks)[0]).toEqual(
        evidence.map(({ mode: _mode, ...checks }) => checks)[1],
      );
      const active = await connection();
      await runtime.dispose();
      runtime = undefined;
      expect(alive(active.pid), "Runtime disposal must preserve the Host-owned daemon").toBe(true);
      await host.stop();
      for (const pid of driverPids)
        await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false);
      console.info("Native CUA fixture verified:", JSON.stringify(evidence));
    } finally {
      try {
        await runtime?.dispose();
      } finally {
        try {
          await host.stop();
        } finally {
          for (const pid of driverPids) if (alive(pid)) process.kill(pid, "SIGKILL");
          try {
            await nativeFixture?.stop();
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        }
      }
    }
  }, 180_000);
});
