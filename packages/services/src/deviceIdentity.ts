import { createUuid } from "@zcode/shared";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAppConfigDir } from "./paths.js";

/** 本地设备身份供账号请求使用；沿用历史文件及锁，不读取端点也不发送数据。 */
interface DeviceIdentityState {
  deviceMid?: string;
  [key: string]: unknown;
}

const LOCK_RETRY_DELAY_MS = 10;

const LOCK_RETRY_COUNT = 200;

const LOCK_STALE_MS = 5 * 60 * 1000;

interface DeviceIdentityLockOwner {
  pid: number;
  createdAt: number;
}

const deviceMidCacheByStateFile = new Map<string, Promise<string>>();

function resolveDeviceIdentityStateFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".zcode", "v2", "telemetry-state.json");
  }
  return join(getAppConfigDir(), "telemetry-state.json");
}

function resolveTelemetryLockFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".zcode", "v2", "telemetry-state.lock");
  }
  return join(getAppConfigDir(), "telemetry-state.lock");
}

async function readDeviceIdentityState(homeDir?: string): Promise<DeviceIdentityState> {
  try {
    const raw = await readFile(resolveDeviceIdentityStateFile(homeDir), "utf-8");
    const parsed = JSON.parse(raw) as DeviceIdentityState;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDeviceIdentityState(
  state: DeviceIdentityState,
  homeDir?: string,
): Promise<void> {
  const telemetryStateFile = resolveDeviceIdentityStateFile(homeDir);
  await mkdir(dirname(telemetryStateFile), { recursive: true });
  await writeFile(telemetryStateFile, JSON.stringify(state, null, 2), "utf-8");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeStaleTelemetryLockIfNeeded(
  lockFile: string,
  timestamp: number,
): Promise<boolean> {
  try {
    const metadata = await stat(lockFile);
    if (timestamp - metadata.mtimeMs < LOCK_STALE_MS) {
      const owner = await readDeviceIdentityLockOwner(lockFile);
      if (!owner || isProcessAlive(owner.pid)) {
        return false;
      }
    }

    await unlink(lockFile).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function readDeviceIdentityLockOwner(
  lockFile: string,
): Promise<DeviceIdentityLockOwner | null> {
  try {
    const raw = await readFile(lockFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DeviceIdentityLockOwner>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return {
        pid: parsed.pid,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ESRCH"
    );
  }
}

async function withDeviceIdentityStateLock<T>(
  homeDir: string | undefined,
  run: (state: DeviceIdentityState) => Promise<T>,
): Promise<T> {
  const lockFile = resolveTelemetryLockFile(homeDir);
  await mkdir(dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        // Bugfix: 旧锁文件只有一个空文件，崩溃后 5 分钟内无法判断是否为孤儿锁。
        // 新锁写入 owner pid，让后续进程能安全回收“刚残留但持有进程已退出”的锁。
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: Date.now(),
          }),
          "utf-8",
        );
        const state = await readDeviceIdentityState(homeDir);
        return await run(state);
      } finally {
        await handle.close();
        await unlink(lockFile).catch(() => {});
      }
    } catch (error) {
      const isLockConflict =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!isLockConflict) {
        throw error;
      }

      // Bugfix: 崩溃/强退后 telemetry-state.lock 可能遗留在磁盘上，后续所有启动都会直接卡死到超时。
      // 这里按 mtime 识别明显过期的孤儿锁并自动回收，避免用户目录里一个陈旧空文件把上报永久锁死。
      const removedStaleLock = await removeStaleTelemetryLockIfNeeded(lockFile, Date.now());
      if (removedStaleLock) {
        continue;
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error("Device identity state lock timeout");
}

export interface EnsureDeviceMidOptions {
  homeDir?: string;
  randomUUID?: () => string;
}

function rememberDeviceMid(telemetryStateFile: string, deviceMid: string): string {
  deviceMidCacheByStateFile.set(telemetryStateFile, Promise.resolve(deviceMid));
  return deviceMid;
}

async function ensureDeviceMidInLockedState(
  state: DeviceIdentityState,
  options: EnsureDeviceMidOptions,
): Promise<string> {
  const telemetryStateFile = resolveDeviceIdentityStateFile(options.homeDir);
  if (state.deviceMid) {
    return rememberDeviceMid(telemetryStateFile, state.deviceMid);
  }

  // device_mid 独立生成，不再复用首条事件的 eventId：让它表达「设备标识」而非
  // 「某次上报」，并与 ARMS 侧（desktopDeviceMid）读取的同一字段保持同值。
  const deviceMid = (options.randomUUID ?? createUuid)();
  state.deviceMid = deviceMid;
  await writeDeviceIdentityState(state, options.homeDir);
  return rememberDeviceMid(telemetryStateFile, deviceMid);
}

export function ensureDeviceMid(options: EnsureDeviceMidOptions = {}): Promise<string> {
  const telemetryStateFile = resolveDeviceIdentityStateFile(options.homeDir);
  const cached = deviceMidCacheByStateFile.get(telemetryStateFile);
  if (cached) {
    return cached;
  }

  // Bugfix: message_completion / agent_step 等高频埋点之前每条都抢 telemetry-state.lock，
  // 即使 deviceMid 已经落盘也会在 burst 场景里把 2 秒锁等待打满。这里按 state 文件缓存
  // deviceMid 的读取 promise，只在首次缺失或首次读取时进入文件锁。
  const pending = withDeviceIdentityStateLock(options.homeDir, async (state) =>
    ensureDeviceMidInLockedState(state, options),
  ).catch((error) => {
    if (deviceMidCacheByStateFile.get(telemetryStateFile) === pending) {
      deviceMidCacheByStateFile.delete(telemetryStateFile);
    }
    throw error;
  });
  deviceMidCacheByStateFile.set(telemetryStateFile, pending);
  return pending;
}
