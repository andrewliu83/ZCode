import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { CuaHelperError } from "./broker.js";
import {
  buildDriverLaunch,
  commandLineFor,
  driverAppIdentity,
  nativeSocketPath,
} from "./driver-platform.js";
import { DRIVER_ENV, loadDriverSdk, parseDriverResult } from "./driver-sdk.js";
import { queryDriverCapture, queryDriverPermissions } from "./driver-probes.js";
import { createCompatibilityTransport } from "./driver-transport.js";

const run = promisify(execFile);
export const DRIVER_VERSION = "0.36.0";

export {
  buildHelperOpenArgs,
  buildDriverLaunch,
  buildDriverLaunchSpec,
  driverAppIdentity,
  DRIVER_BUNDLE_ID,
} from "./driver-platform.js";

export function createDriverHost(options = {}) {
  const env = options.env ?? process.env;
  // 仅供宿主生命周期回归注入 IO；不扩展公开 broker 或运行时契约。
  const deps = {
    exec: run,
    sdk: loadDriverSdk,
    identity: driverAppIdentity,
    signal: (pid, signal) => process.kill(pid, signal),
    ...options.dependencies,
  };
  // 未注入时用同一 exec 读取命令行，测试和平台分支共享一个 IO 缝。
  deps.commandLine ??= (pid) => commandLineFor(pid, deps.exec);
  const sdkPath =
    env.ZCODE_CUA_DRIVER_SDK_PATH?.trim() ||
    (process.resourcesPath
      ? join(process.resourcesPath, "tools", "cua-driver", "node_modules", "@trycua", "cua-driver")
      : undefined);
  let compatibility;
  let native;
  let starting;
  let revision = 0;
  let reserving;
  let stopping;
  let closed = false;
  let tail = Promise.resolve();
  const controller = new AbortController();
  const timeoutMs = options.healthTimeoutMs ?? 30_000;
  const assertOpen = () => {
    if (closed) throw new CuaHelperError("Computer Use host is disposed.");
  };
  const querySignal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  // 所有原生读写由同一队列持有；stop 先关准入，再等待在途查询结束后销毁句柄。
  function admit(operation) {
    if (closed) return Promise.reject(new CuaHelperError("Computer Use host is disposed."));
    const task = tail.then(async () => {
      assertOpen();
      const result = await operation();
      assertOpen();
      return result;
    });
    tail = task.catch(() => {});
    return task;
  }
  const health = () =>
    admit(async () => {
      await ensureNative();
      return { bundleId: native.identity.bundleId, pid: native.connection.pid };
    });
  async function call(target, name, args, signal) {
    const output = await target.callTool(name, JSON.stringify(args), { signal });
    if (output.isError)
      throw new CuaHelperError(output.text || `Cua Driver ${name} failed.`, {
        code: output.errorCode,
      });
    const payload = parseDriverResult(output);
    if (!payload) throw new CuaHelperError(`Cua Driver ${name} returned no structured data.`);
    return payload;
  }
  async function reserve() {
    assertOpen();
    if (compatibility) return compatibility.transport;
    if (reserving) return reserving;
    reserving = createCompatibilityTransport({
      timeoutMs,
      backend: {
        ping: health,
        get_driver_connection: () =>
          admit(async () => {
            await ensureNative();
            return { ...native.connection };
          }),
        permission_status: (params) => host.queryPermissionStatus(params),
        screen_recording_preflight: async () => undefined,
        screen_capture_probe: () => host.queryScreenCaptureProbe(),
      },
    }).then((created) => {
      assertOpen();
      compatibility = created;
      return created.transport;
    });
    try {
      return await reserving;
    } finally {
      reserving = undefined;
    }
  }
  async function terminate(generation) {
    const filePid = Number(await readFile(generation.pidFile, "utf8").catch(() => ""));
    for (const pid of new Set([generation.connection.pid, filePid])) {
      if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) continue;
      // PID/元数据可能过期或未通过握手：必须同时匹配精确可执行路径、socket 与本代 pid 文件。
      const command = await deps.commandLine(pid);
      if (
        !command ||
        !command.includes(generation.identity.executablePath) ||
        !command.includes(generation.connection.socketPath) ||
        !command.includes(generation.pidFile)
      )
        continue;
      try {
        deps.signal(pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  async function releaseNative() {
    const previous = native;
    native = undefined;
    if (!previous) return;
    try {
      previous.client?.uniffiDestroy();
    } finally {
      await terminate(previous);
    }
  }
  async function ensureNative() {
    assertOpen();
    if (native) {
      const signal = querySignal();
      try {
        const metadata = await native.client.metadata({ signal });
        assertOpen();
        if (
          metadata.pid === native.connection.pid &&
          metadata.driverVersion === DRIVER_VERSION &&
          !metadata.embedded
        )
          return;
      } catch (error) {
        if (signal.aborted) throw error;
        assertOpen();
        /* 原生进程退出后重建代次；队列保证旧健康查询不能释放新连接。 */
      }
      await releaseNative();
    }
    await reserve();
    const executable = await options.helperInstaller.ensureInstalled();
    const identity = await deps.identity(executable);
    const sdk = await deps.sdk(env);
    assertOpen();
    const generation = randomUUID();
    const pending = {
      identity,
      pidFile: join(compatibility.directory, `${generation}.pid`),
      connection: {
        socketPath: nativeSocketPath(compatibility.directory),
        generation,
        ...(sdkPath ? { sdkPath } : {}),
      },
    };
    const signal = querySignal();
    // Launch 接受后超时或 connect 抛错，也须进入本代验证清理。
    try {
      const launch = buildDriverLaunch({
        appPath: identity.appPath,
        executablePath: identity.executablePath,
        socketPath: pending.connection.socketPath,
        pidFile: pending.pidFile,
      });
      await deps.exec(launch.command, launch.args, {
        env: { ...process.env, ...env, ...DRIVER_ENV },
        timeout: 10_000,
        signal,
        ...(process.platform === "win32" ? { windowsHide: true, detached: true } : {}),
      });
      assertOpen();
      pending.client = sdk.CuaDriver.connect(pending.connection.socketPath);
      let metadata;
      while (!metadata) {
        signal.throwIfAborted();
        try {
          metadata = await pending.client.metadata({ signal });
        } catch (error) {
          if (signal.aborted) throw error;
          await delay(100, undefined, { signal });
        }
      }
      pending.connection.pid = metadata.pid;
      if (
        metadata.driverVersion !== DRIVER_VERSION ||
        !Number.isSafeInteger(metadata.pid) ||
        metadata.pid <= 0 ||
        metadata.embedded
      ) {
        throw new CuaHelperError("Cua Driver did not identify the expected standalone version.");
      }
      const permissions = await call(
        pending.client,
        "check_permissions",
        { prompt: false, probe_direct_capture: false },
        signal,
      );
      const source = permissions.source;
      if (
        source?.pid !== metadata.pid ||
        source.bundle_id !== identity.bundleId ||
        (await realpath(source.executable)) !== identity.executablePath ||
        source.attribution !== "driver-daemon"
      ) {
        throw new CuaHelperError("Cua Driver permission owner does not match the verified app.");
      }
      assertOpen();
      native = pending;
    } catch (error) {
      try {
        pending.client?.uniffiDestroy();
      } finally {
        await terminate(pending);
      }
      throw error;
    }
  }
  function handle() {
    return {
      ...compatibility.transport,
      launchSocketPath: native.connection.socketPath,
      helperAppPath: native.identity.appPath,
      bundleId: native.identity.bundleId,
      pid: native.connection.pid,
    };
  }
  function start() {
    if (closed) return Promise.reject(new CuaHelperError("Computer Use host is disposed."));
    if (starting?.revision === revision) return starting.task;
    const current = {
      revision,
      task: admit(async () => {
        await ensureNative();
        return handle();
      }),
    };
    starting = current;
    void current.task
      .finally(() => {
        if (starting === current) starting = undefined;
      })
      .catch(() => {});
    return current.task;
  }
  function restart(beforeFreshStart) {
    revision += 1;
    return admit(async () => {
      await releaseNative();
      assertOpen();
      beforeFreshStart?.();
      await ensureNative();
      return handle();
    });
  }
  const host = {
    get running() {
      return Boolean(native);
    },
    get socketPath() {
      return compatibility?.transport.socketPath ?? null;
    },
    get pluginAuthority() {
      return compatibility?.transport.pluginAuthority ?? null;
    },
    get reservedTransport() {
      return compatibility?.transport;
    },
    start,
    waitForTransport: reserve,
    restart: () => restart(),
    restartAfterCurrentStart: () => restart(),
    async restartAfterCurrentStartPreservingTransport(restartOptions) {
      return { handle: await restart(restartOptions?.beforeFreshStart), reused: false };
    },
    checkHealth: health,
    queryPermissionStatus: (queryOptions) =>
      admit(async () => {
        await ensureNative();
        return await queryDriverPermissions(native, queryOptions, querySignal());
      }),
    async queryScreenRecordingPreflight() {
      return undefined;
    },
    queryScreenCaptureProbe: () =>
      admit(async () => {
        await ensureNative();
        return await queryDriverCapture(native, querySignal());
      }),
    stop() {
      if (stopping) return stopping;
      closed = true;
      controller.abort(new CuaHelperError("Computer Use host is disposed."));
      stopping = tail.then(async () => {
        await reserving?.catch(() => {});
        try {
          await releaseNative();
        } finally {
          const created = compatibility;
          compatibility = undefined;
          if (created) {
            await created.close();
            await rm(created.directory, { recursive: true, force: true });
          }
        }
      });
      return stopping;
    },
  };
  return host;
}
