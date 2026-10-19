import { realpath, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callBrokerMethod } from "../broker.js";
import { createDriverHost, DRIVER_BUNDLE_ID, DRIVER_VERSION } from "../driver-host.js";

const hosts: Array<ReturnType<typeof createDriverHost>> = [];
const unblockers: Array<() => void> = [];
afterEach(async () => {
  for (const unblock of unblockers.splice(0)) unblock();
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

function deferred<T>(fallback: T) {
  const pending = Promise.withResolvers<T>();
  unblockers.push(() => pending.resolve(fallback));
  return pending;
}

function mockClient(pid: number, executablePath: string) {
  const metadata = { pid, driverVersion: DRIVER_VERSION, embedded: false };
  const permissions = {
    accessibility: true,
    screen_recording: false,
    source: {
      pid,
      bundle_id: DRIVER_BUNDLE_ID,
      executable: executablePath,
      attribution: "driver-daemon",
    },
  };
  return {
    metadataValue: metadata,
    permissions,
    metadata: vi.fn(async (_options?: { signal: AbortSignal }) => metadata),
    callTool: vi.fn(async (_name: string, _json: string, _options?: { signal: AbortSignal }) => ({
      rawJson: JSON.stringify(permissions),
    })),
    uniffiDestroy: vi.fn(),
  };
}

type Launch = {
  pid: number;
  socketPath: string;
  pidFile: string;
  args: string[];
  client: ReturnType<typeof mockClient>;
};

async function fixture(
  options: {
    configure?: (launch: Launch) => void | Promise<void>;
    openError?: Error;
    connectError?: Error;
    env?: Record<string, string>;
    healthTimeoutMs?: number;
  } = {},
) {
  const executablePath = await realpath(process.execPath);
  const appPath = "/staged/CuaDriver.app";
  const processes = new Map<number, string>();
  const launches: Launch[] = [];
  const exec = vi.fn(async (file: string, args: string[]) => {
    if (file === "/usr/bin/open") {
      const pid = 9000 + launches.length;
      const socketPath = args[args.indexOf("--socket") + 1];
      const pidFile = args[args.indexOf("--pid-file") + 1];
      const launch = { pid, socketPath, pidFile, args, client: mockClient(pid, executablePath) };
      launches.push(launch);
      processes.set(pid, `${executablePath} ${args.slice(args.indexOf("--args") + 1).join(" ")}`);
      await writeFile(pidFile, String(pid));
      await options.configure?.(launch);
      if (options.openError) throw options.openError;
      return { stdout: "", stderr: "" };
    }
    if (file === "/bin/ps") {
      return { stdout: processes.get(Number(args[args.indexOf("-p") + 1])) ?? "", stderr: "" };
    }
    throw new Error(`Unexpected executable ${file}`);
  });
  const connect = vi.fn((socketPath: string) => {
    if (options.connectError) throw options.connectError;
    const launch = launches.find((item) => item.socketPath === socketPath);
    if (!launch) throw new Error("Unknown native endpoint");
    return launch.client;
  });
  const signal = vi.fn((_pid: number, _signal: NodeJS.Signals) => true);
  const sdk = vi.fn(async () => ({ CuaDriver: { connect } }));
  const host = createDriverHost({
    env: options.env ?? { ZCODE_CUA_DRIVER_SDK_PATH: " /staged/sdk " },
    healthTimeoutMs: options.healthTimeoutMs ?? 1000,
    helperInstaller: { ensureInstalled: async () => appPath },
    dependencies: {
      exec,
      sdk,
      identity: async () => ({
        appPath,
        executablePath,
        bundleId: DRIVER_BUNDLE_ID,
        displayName: "CuaDriver",
      }),
      signal,
    },
  });
  hosts.push(host);
  const descriptor = () =>
    callBrokerMethod({ socketPath: host.socketPath!, method: "get_driver_connection" });
  return { host, launches, processes, exec, connect, signal, sdk, descriptor, executablePath };
}

function untilAborted(signal: AbortSignal): Promise<never> {
  signal.throwIfAborted();
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("native Cua Driver host concurrency", () => {
  it("coalesces both startup and existing-generation health admission", async () => {
    const entered = deferred(undefined);
    const gate = deferred(undefined);
    const f = await fixture({
      configure: ({ client }) => {
        client.metadata.mockImplementationOnce(async () => {
          entered.resolve();
          await gate.promise;
          return client.metadataValue;
        });
      },
    });
    const first = f.host.start();
    const second = f.host.start();
    await entered.promise;
    expect(f.launches).toHaveLength(1);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    const client = f.launches[0].client;
    const healthEntered = deferred(undefined);
    const healthGate = deferred(undefined);
    client.metadata.mockImplementationOnce(async () => {
      healthEntered.resolve();
      await healthGate.promise;
      return client.metadataValue;
    });
    const third = f.host.start();
    const fourth = f.host.start();
    await healthEntered.promise;
    expect(client.metadata).toHaveBeenCalledTimes(2);
    healthGate.resolve();
    expect(await Promise.all([third, fourth])).toEqual([a, a]);
    expect(f.launches).toHaveLength(1);
  });

  it("serializes stale health and restart while retaining the compatibility transport", async () => {
    const f = await fixture();
    const original = await f.host.start();
    const initialDescriptor = await f.descriptor();
    const entered = deferred(undefined);
    const gate = deferred(undefined);
    const old = f.launches[0].client;
    old.metadata.mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
      throw new Error("Native daemon exited");
    });
    const recovering = f.host.start();
    await entered.promise;
    const beforeFreshStart = vi.fn();
    const restarting = f.host.restartAfterCurrentStartPreservingTransport({ beforeFreshStart });
    const afterRestart = f.host.start();
    expect(beforeFreshStart).not.toHaveBeenCalled();
    expect(old.uniffiDestroy).not.toHaveBeenCalled();
    gate.resolve();
    const [recovered, restarted, following] = await Promise.all([
      recovering,
      restarting,
      afterRestart,
    ]);
    expect(recovered.pid).not.toBe(original.pid);
    expect(restarted.handle.pid).not.toBe(recovered.pid);
    expect(following).toEqual(restarted.handle);
    expect(restarted.reused).toBe(false);
    expect(restarted.handle.socketPath).toBe(original.socketPath);
    expect(restarted.handle.pluginAuthority).toBe(original.pluginAuthority);
    expect(beforeFreshStart).toHaveBeenCalledTimes(1);
    expect(f.launches[0].client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(f.launches[1].client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(f.launches[2].client.uniffiDestroy).not.toHaveBeenCalled();
    const finalDescriptor = await f.descriptor();
    expect(finalDescriptor.generation).not.toBe(initialDescriptor.generation);
    expect(finalDescriptor.socketPath).toBe(following.launchSocketPath);
    expect(finalDescriptor.sdkPath).toBe("/staged/sdk");
    expect(new Set(f.launches.map((item) => item.pidFile)).size).toBe(3);
  });

  it("never returns a health handle after stop and waits for its query before destroying it", async () => {
    const f = await fixture();
    await f.host.start();
    const client = f.launches[0].client;
    const entered = deferred(undefined);
    const gate = deferred(undefined);
    client.metadata.mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
      return client.metadataValue;
    });
    const pending = f.host.start();
    const rejected = expect(pending).rejects.toThrow(/disposed|canceled/iu);
    await entered.promise;
    const stopped = f.host.stop();
    expect(client.uniffiDestroy).not.toHaveBeenCalled();
    expect(f.signal).not.toHaveBeenCalled();
    await expect(f.host.start()).rejects.toThrow(/disposed/iu);
    await expect(f.host.restart()).rejects.toThrow(/disposed/iu);
    gate.resolve();
    await rejected;
    await stopped;
    expect(client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(f.signal).toHaveBeenCalledExactlyOnceWith(f.launches[0].pid, "SIGTERM");
    expect(f.host.running).toBe(false);
    expect(f.host.socketPath).toBeNull();
  });

  it("drains admitted permission queries before native teardown and rejects queued restarts after stop", async () => {
    const f = await fixture();
    await f.host.start();
    const client = f.launches[0].client;
    const entered = deferred(undefined);
    const gate = deferred(undefined);
    let querySignal: AbortSignal | undefined;
    client.callTool.mockImplementationOnce(async (_name, _args, options) => {
      querySignal = options?.signal;
      entered.resolve();
      await gate.promise;
      return { rawJson: JSON.stringify(client.permissions) };
    });
    const pending = f.host.queryPermissionStatus();
    const rejected = expect(pending).rejects.toThrow(/disposed|canceled/iu);
    await entered.promise;
    const restarting = f.host.restart();
    const restartRejected = expect(restarting).rejects.toThrow(/disposed/iu);
    const stopped = f.host.stop();
    let complete = false;
    void stopped.then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(querySignal?.aborted).toBe(true);
    expect(client.uniffiDestroy).not.toHaveBeenCalled();
    expect(f.launches).toHaveLength(1);
    gate.resolve();
    await Promise.all([rejected, restartRejected, stopped]);
    expect(client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(f.launches).toHaveLength(1);
  });

  it.each(["metadata", "permissions"])(
    "aborts pending startup %s on terminal stop",
    async (phase) => {
      const entered = deferred(undefined);
      const f = await fixture({
        configure: ({ client }) => {
          const pending = (options?: { signal: AbortSignal }) => {
            if (!options?.signal) throw new Error("Startup is missing an AbortSignal");
            entered.resolve();
            return untilAborted(options.signal);
          };
          if (phase === "metadata") client.metadata.mockImplementationOnce(pending);
          else client.callTool.mockImplementationOnce((_name, _args, options) => pending(options));
        },
      });
      const startup = f.host.start();
      const rejected = expect(startup).rejects.toThrow();
      await entered.promise;
      const stopped = f.host.stop();
      await Promise.all([rejected, stopped]);
      expect(f.launches[0].client.uniffiDestroy).toHaveBeenCalledTimes(1);
      expect(f.signal).toHaveBeenCalledExactlyOnceWith(f.launches[0].pid, "SIGTERM");
      expect(f.host.running).toBe(false);
    },
  );

  it("bounds startup metadata with the health timeout", async () => {
    const f = await fixture({
      healthTimeoutMs: 25,
      configure: ({ client }) => {
        client.metadata.mockImplementationOnce((options) => {
          if (!options?.signal) throw new Error("Startup is missing an AbortSignal");
          return untilAborted(options.signal);
        });
      },
    });
    await expect(f.host.start()).rejects.toThrow(/timeout/iu);
    expect(f.launches[0].client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(f.signal).toHaveBeenCalledExactlyOnceWith(f.launches[0].pid, "SIGTERM");
  });

  it.each(["launch", "connect"])("cleans its verified pid file after %s fails", async (phase) => {
    const failure = new Error(`${phase} failed after LaunchServices accepted`);
    const f = await fixture(
      phase === "launch" ? { openError: failure } : { connectError: failure },
    );
    await expect(f.host.start()).rejects.toBe(failure);
    expect(f.signal).toHaveBeenCalledExactlyOnceWith(f.launches[0].pid, "SIGTERM");
    expect(f.host.running).toBe(false);
    expect(f.launches[0].client.uniffiDestroy).not.toHaveBeenCalled();
  });

  it("rejects unverified metadata and stale pid files without signaling unrelated processes", async () => {
    const f = await fixture({
      configure: async ({ client, pidFile }) => {
        client.metadata.mockResolvedValue({ ...client.metadataValue, pid: 1234 });
        await writeFile(pidFile, "5678");
      },
    });
    // 同路径的另一代 Driver 与可执行路径前缀都不能证明本代进程所有权。
    f.processes.set(
      1234,
      `${f.executablePath} serve --socket /another.sock --pid-file /another.pid`,
    );
    f.processes.set(5678, `${f.executablePath}-other serve --socket /unrelated.sock`);
    await expect(f.host.start()).rejects.toThrow(/permission owner/iu);
    expect(f.signal).not.toHaveBeenCalled();
    expect(f.launches[0].client.uniffiDestroy).toHaveBeenCalledTimes(1);
  });

  it("verifies executable and generation again before signaling a previously healthy pid", async () => {
    const f = await fixture();
    await f.host.start();
    const launch = f.launches[0];
    f.processes.set(
      launch.pid,
      `/usr/bin/unrelated serve --socket ${launch.socketPath} --pid-file ${launch.pidFile}`,
    );
    await f.host.stop();
    expect(f.signal).not.toHaveBeenCalled();
    expect(launch.client.uniffiDestroy).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary status queries explicit about prompts and functional probes", async () => {
    const f = await fixture();
    const status = await f.host.queryPermissionStatus();
    expect(status).toMatchObject({
      accessibility: "granted",
      screen_recording: "denied",
      accessibility_probe_ok: false,
      accessibility_probe: { ok: false, classification: "not_checked" },
    });
    for (const [name, args, options] of f.launches[0].client.callTool.mock.calls) {
      expect(name).toBe("check_permissions");
      expect(JSON.parse(args)).toEqual({ prompt: false, probe_direct_capture: false });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(await f.host.queryScreenCaptureProbe()).toMatchObject({ ok: false });
    expect(await f.host.queryScreenRecordingPreflight()).toBeUndefined();
  });
});
