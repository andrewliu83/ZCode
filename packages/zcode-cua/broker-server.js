import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { CuaHelperError } from "./broker.js";
import { buildHelperOpenArgs, createDriverHost, driverAppIdentity } from "./driver-host.js";

export const HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";
const run = promisify(execFile);
const UNSUPPORTED = "This legacy Helper interface is not supported by Cua Driver.";
const unavailable = () => {
  throw new CuaHelperError(UNSUPPORTED);
};
export { buildHelperOpenArgs };
export const resolveHelperPermissionSubjectIdentity = driverAppIdentity;

export function isCuaLocalDevelopmentRuntime(
  env = process.env,
  compiled = env.NODE_ENV !== "production",
) {
  return compiled && env.ZCODE_RUNTIME_ENV !== "production";
}

export const defaultCuaHelperVerifierDependencies = {
  async readExecutableArchs(executablePath) {
    const { stdout } = await run("/usr/bin/lipo", ["-archs", executablePath]);
    return stdout
      .trim()
      .split(/\s+/u)
      .map((arch) => (arch === "x86_64" ? "x64" : arch));
  },
  async verifyCodeSignature(appPath) {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  },
};

export function createCuaHelperInstaller(options = {}) {
  const deps = { ...defaultCuaHelperVerifierDependencies, ...options.dependencies };
  async function verifyInstalled(appPath) {
    const identity = await driverAppIdentity(appPath);
    await access(identity.executablePath);
    const archs = await deps.readExecutableArchs(identity.executablePath);
    if (!archs.includes(process.arch))
      throw new CuaHelperError("Cua Driver architecture does not match this device.");
    await deps.verifyCodeSignature(identity.appPath);
    const { stdout } = await run(identity.executablePath, ["--version"]);
    if (stdout.trim() !== "cua-driver 0.36.0")
      throw new CuaHelperError("Cua Driver version does not match the pinned SDK.");
  }
  return {
    async ensureInstalled() {
      const path = options.bundledAppPath ?? options.env?.ZCODE_CUA_BUNDLED_HELPER_APP_PATH;
      if (!path) throw new CuaHelperError("The bundled Cua Driver app path is missing.");
      await verifyInstalled(path);
      return path;
    },
    verifyInstalled,
  };
}

export function cuaBrokerRefreshMarkerPath(socketPath) {
  return socketPath?.startsWith("\\\\.\\pipe\\") ? undefined : `${socketPath}.refresh`;
}
export async function publishCuaBrokerRefreshMarker(socketPath) {
  const path = cuaBrokerRefreshMarkerPath(socketPath);
  if (path) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(Date.now()), { mode: 0o600 });
  }
  return { path };
}
export const loadRealNativeAddon = unavailable;
export function resolvePackagedNativeAddonPath() {
  return undefined;
}
export function resolveInTreeAddonPath() {
  return undefined;
}
export function createAxReadOnlyMethods() {
  return {};
}
export const ROLE_TO_KIND = Object.freeze({});
export function roleToKind(role) {
  return typeof role === "string" ? role : undefined;
}

export class CuaHelperLifecycleManager {
  #dispose;
  #current;
  #disposed = false;
  #tail = Promise.resolve();
  constructor(dispose) {
    this.#dispose = dispose;
  }
  acquire(options) {
    const task = this.#tail.then(async () => {
      if (this.#disposed || options.isAdmitted?.() === false) return undefined;
      if (this.#current && options.shouldRetainCurrent?.(this.#current) !== false)
        return this.#current;
      if (this.#current) await this.#dispose?.(this.#current);
      this.#current = options.create();
      return this.#current;
    });
    this.#tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  peek() {
    return this.#disposed ? undefined : this.#current;
  }
  get disposed() {
    return this.#disposed;
  }
  async dispose(managed) {
    if (this.#disposed) return this.#tail;
    this.#disposed = true;
    const task = this.#tail.then(async () => {
      const current = managed ?? this.#current;
      this.#current = undefined;
      if (current) await this.#dispose?.(current);
    });
    this.#tail = task;
    return task;
  }
}

const workspaceEnabled = new Map();
const keyOf = (context) => context?.workspaceIdentity?.trim() || context?.workspacePath;
export class CuaProductHelperWorkspaceRegistry {
  setEnabled(context, enabled) {
    const key = keyOf(context);
    if (key) workspaceEnabled.set(key, enabled);
  }
}
export function isOfficialCuaPluginEnabledForWorkspace(options = {}) {
  const explicit = workspaceEnabled.get(options.workingDirectory);
  if (explicit !== undefined) return explicit;
  const env = options.env ?? process.env;
  return !/^(?:0|false|off)$/iu.test(env.ZCODE_CUA_PRODUCT_HELPER ?? "");
}
export function createProductCuaHelperHost(options = {}) {
  return createDriverHost({
    ...options,
    helperInstaller:
      options.helperInstaller ??
      createCuaHelperInstaller({
        env: options.env,
        bundledAppPath: options.bundledHelperAppPath,
      }),
  });
}
export function createCuaProductMcpServerResolver(host, options = {}) {
  const recoveries = new Map();
  const restart = async () => {
    if (options.hasActiveTurn?.())
      throw new CuaHelperError(
        "Computer Use is active; retry recovery after the current operation.",
      );
    await host.restartAfterCurrentStart();
  };
  return {
    async resolveMcpServers(servers) {
      return servers;
    },
    restart,
    async restartAfterPermissionGrant(sessionId) {
      const key = sessionId || "current";
      if (recoveries.has(key)) return recoveries.get(key);
      const result = restart();
      recoveries.set(key, result);
      try {
        await result;
      } catch (error) {
        recoveries.delete(key);
        throw error;
      }
      if (recoveries.size > 32) recoveries.delete(recoveries.keys().next().value);
    },
  };
}
export async function waitForCuaHelperStartup(startup) {
  return startup;
}
export function isPotentialZCodeCuaAgentMcpServer(server) {
  return server?.name === "computer-use" || server?.name === "zcode-cua";
}
export function isScreenCaptureProbeSuccess(probe) {
  return probe?.ok === true;
}
const unavailableHosts = new WeakSet();
export function markCuaProductHelperAgentEnvUnavailable(host) {
  unavailableHosts.add(host);
}
export function hasCuaProductHelperAgentEnvUnavailable(host) {
  return unavailableHosts.has(host);
}
export function clearCuaProductHelperAgentEnvUnavailable(host) {
  unavailableHosts.delete(host);
}
export async function reapOrphanedHelpers() {}
export async function requestHelperAccessibilityPermissionViaLaunchServices() {
  return {
    ok: false,
    reason: "Use the desktop permission onboarding for the verified CuaDriver app.",
  };
}
export const requestHelperScreenRecordingPermissionViaLaunchServices =
  requestHelperAccessibilityPermissionViaLaunchServices;
export function resolveHelperAppName() {
  return "CuaDriver.app";
}
export function resolveCuaHelperInstallRoot(env) {
  const app = env.ZCODE_CUA_BUNDLED_HELPER_APP_PATH;
  return app ? dirname(app) : null;
}
export function standaloneHelperCandidatePaths(env = process.env) {
  return env.ZCODE_CUA_BUNDLED_HELPER_APP_PATH ? [env.ZCODE_CUA_BUNDLED_HELPER_APP_PATH] : [];
}
export function injectPermissionBrokerAgentMcpServers(servers) {
  return servers;
}
