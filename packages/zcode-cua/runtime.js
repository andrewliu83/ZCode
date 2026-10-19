import { createHmac, randomBytes } from "node:crypto";
import { callBrokerMethod, resolveBrokerSocketPath } from "./broker.js";
import { loadDriverSdk, parseDriverResult } from "./driver-sdk.js";
import { createRuntimeActions } from "./runtime-actions.js";
import { createRuntimeObservation, targetKey } from "./runtime-observation.js";
import {
  CUA_REQUEST_ACCESS_STATUS_META_KEY,
  cuaRequestAccessStatusSchema,
} from "./request-access-contract.js";

// Driver 的同窗口快照会互相替换；跨 runtime 也必须串行准入并持有独占租约。
let admission = Promise.resolve();
const windowLeases = new Map();
const serialize = (operation) => {
  const result = admission.then(operation);
  admission = result.catch(() => {});
  return result;
};
export function createRuntime(options, helpers) {
  const {
    record,
    fail,
    envelope,
    appReference,
    contextKey,
    validateArguments,
    nativeFailure,
    checkLive,
  } = helpers;
  const env = options.env ?? process.env;
  const secret = randomBytes(32);
  const sessions = new Map();
  let client;
  let connection;
  let disposed = false;
  let disposal;

  function getSession(context) {
    const key = contextKey(context);
    let session = sessions.get(key);
    if (!session) {
      session = {
        label: `zcode-${createHmac("sha256", secret).update(key).digest("hex").slice(0, 32)}`,
        controller: new AbortController(),
        states: new Map(),
        leases: new Set(),
        closed: false,
        touched: false,
      };
      sessions.set(key, session);
    }
    return session;
  }
  function clear(session) {
    session.states.clear();
    for (const key of session.leases)
      if (windowLeases.get(key) === session) windowLeases.delete(key);
    session.leases.clear();
  }
  async function releaseClient() {
    const previous = client;
    client = undefined;
    connection = undefined;
    if (!previous) return;
    try {
      await previous.shutdown();
    } finally {
      previous.uniffiDestroy();
    }
  }
  async function connect(session, operation) {
    checkLive(session, disposed, operation.signal);
    let next;
    const override = env.ZCODE_CUA_DRIVER_SOCKET_PATH?.trim();
    if (override) {
      next = { socketPath: override, generation: `explicit:${override}` };
    } else {
      await options.ensureBrokerAvailable?.();
      checkLive(session, disposed, operation.signal);
      next = await callBrokerMethod({
        socketPath: options.brokerSocketPath ?? resolveBrokerSocketPath({ env }),
        method: "get_driver_connection",
        params: {},
        signal: operation.signal,
      });
    }
    checkLive(session, disposed, operation.signal);
    if (
      !record(next) ||
      typeof next.socketPath !== "string" ||
      !next.socketPath ||
      typeof next.generation !== "string" ||
      !next.generation
    )
      fail("broker_unavailable", "The Host did not provide a valid Driver connection.");
    if (
      client &&
      (connection.socketPath !== next.socketPath ||
        connection.generation !== next.generation ||
        connection.pid !== next.pid ||
        connection.sdkPath !== next.sdkPath)
    ) {
      for (const value of sessions.values()) {
        clear(value);
        value.touched = false;
      }
      await releaseClient();
    }
    if (!client) {
      // SDK 的真实资源位置由 Host 提供；加载器在导入前校验绝对路径。
      const sdk = await loadDriverSdk({
        ...env,
        ...(next.sdkPath ? { ZCODE_CUA_DRIVER_SDK_PATH: next.sdkPath } : {}),
      });
      checkLive(session, disposed, operation.signal);
      client = await sdk.CuaDriver.connect(next.socketPath);
      connection = next;
      checkLive(session, disposed, operation.signal);
    }
  }
  async function call(name, args, session, operation, action = false) {
    checkLive(session, disposed, operation.signal);
    if (args.session) session.touched = true;
    if (action) operation.dispatched = true;
    const result = await client.callTool(name, JSON.stringify(args), { signal: operation.signal });
    const data = parseDriverResult(result);
    if (action) {
      const receipt = record(data?.action)
        ? data.action
        : data?.effect !== undefined
          ? data
          : result.action;
      const refused = receipt?.effect === "refused" || receipt?.effect === 4;
      const delivery = receipt?.delivery;
      const delivered = delivery?.delivered_count ?? delivery?.deliveredCount;
      if (refused || result.isError) {
        operation.sent ||= delivered > 0;
        operation.dispatched = operation.sent;
        fail(
          receipt?.error?.code ?? result.errorCode ?? data?.code ?? "action_unavailable",
          receipt?.error?.message ??
            data?.message ??
            data?.reason ??
            result.text ??
            "Driver refused the action.",
        );
      }
      if (
        !["confirmed", "partial", "unverifiable", "suspected_noop", 0, 1, 2, 3].includes(
          receipt?.effect,
        )
      )
        fail("internal", "Driver returned no verifiable action receipt; observe before retrying.");
      const axDelivery =
        ["accessibility", 0].includes(receipt?.route) &&
        ["not_applicable", 2].includes(delivery?.mode);
      if (delivery?.mode !== undefined && !["background", 0].includes(delivery.mode) && !axDelivery)
        fail("internal", "Driver reported an unexpected input delivery mode.");
      operation.sent = true;
      operation.dispatched = false;
      operation.action = receipt;
    } else if (result.isError) {
      fail(
        result.errorCode ?? data?.code ?? "internal",
        data?.message ?? result.text ?? "Driver operation failed.",
      );
    }
    if (!action) checkLive(session, disposed, operation.signal);
    return { data, result };
  }
  function lease(app, window, session) {
    const key = JSON.stringify([
      connection.socketPath,
      connection.generation,
      app.pid,
      window.window_id,
    ]);
    const owner = windowLeases.get(key);
    if (owner && owner !== session)
      fail("controller_busy", "Another Computer Use session controls this window.");
    windowLeases.set(key, session);
    session.leases.add(key);
  }
  const getGeneration = () => connection.generation;
  const { inventory, resolveApp, windows, observe } = createRuntimeObservation({
    helpers,
    call,
    lease,
    getGeneration,
  });
  const act = createRuntimeActions({
    helpers,
    call,
    lease,
    observe,
    getGeneration,
    targetKey,
    policy: {
      // 后台像素聚焦是默认路由；系统层拒绝时才允许显式前台升级。
      backgroundFocus: options.backgroundFocus ?? "auto",
      // 驱动确认后台无法投递时才升级；该次动作生效并恢复原前台，可用环境变量禁用。
      foregroundEscalation:
        options.foregroundEscalation ?? env.ZCODE_CUA_FOREGROUND_ESCALATION ?? "explicit",
    },
  });

  async function permissions(args, session, operation) {
    const requested = args.capabilities ?? ["accessibility", "screen_recording"];
    if (
      !Array.isArray(requested) ||
      requested.some(
        (value) => !["accessibility", "screen_recording", "screenRecording"].includes(value),
      )
    )
      fail("invalid_request", "Unsupported permission capability.");
    const { data } = await call(
      "check_permissions",
      { prompt: false, probe_direct_capture: false, session: session.label },
      session,
      operation,
    );
    const status = {
      accessibility: data?.accessibility === true ? "granted" : "denied",
      screenRecording:
        data?.screen_recording === true
          ? "granted"
          : data?.screen_recording === false
            ? "denied"
            : "unknown",
    };
    const ready = requested.every(
      (value) =>
        status[value === "accessibility" ? "accessibility" : "screenRecording"] === "granted",
    );
    const output = envelope(
      {
        ...status,
        ready,
        ...(!ready
          ? {
              code: "permission_denied",
              message:
                "Grant the required permissions from the application's permission settings, then refresh.",
            }
          : {}),
      },
      !ready,
    );
    const parsed = cuaRequestAccessStatusSchema.safeParse({
      schemaVersion: 1,
      platform: process.platform,
      // 独立 Driver app 使用 bundle_id；嵌入式执行才回落到 Host 报告的授权主体。
      grantOwner: data?.source?.bundle_id || data?.source?.host_bundle_id,
      ...status,
    });
    if (parsed.success) output._meta = { [CUA_REQUEST_ACCESS_STATUS_META_KEY]: parsed.data };
    return output;
  }
  async function end(session) {
    try {
      if (client && session.touched) {
        const result = await client.callTool(
          "end_session",
          JSON.stringify({ session: session.label }),
        );
        if (result.isError)
          fail(
            result.errorCode ?? "internal",
            result.text || "Driver could not end the owned session.",
          );
        session.touched = false;
      }
    } finally {
      clear(session);
    }
  }
  function close(session) {
    session.closed = true;
    session.controller.abort();
    if (!session.closing) session.closing = serialize(() => end(session));
    return session.closing;
  }
  return {
    async execute(input) {
      const operation = { dispatched: false, sent: false, signal: input?.signal };
      try {
        const session = getSession(input?.context);
        checkLive(session, disposed, input.signal);
        const args = input.arguments ?? {};
        validateArguments(input.toolName, args);
        if (input.toolName === "stop_computer_control") {
          await close(session);
          return envelope({ stopped: true, action_sent: false, dispatch_status: "not_sent" });
        }
        operation.signal = input.signal
          ? AbortSignal.any([input.signal, session.controller.signal])
          : session.controller.signal;
        return await serialize(async () => {
          checkLive(session, disposed, operation.signal);
          await connect(session, operation);
          if (input.toolName === "request_access")
            return await permissions(args, session, operation);
          if (input.toolName === "list_apps") return envelope(await inventory(session, operation));
          if (input.toolName === "list_windows") {
            const app =
              args.app_ref === undefined
                ? undefined
                : await resolveApp(appReference(args.app_ref), session, operation);
            return envelope(await windows(app, session, operation));
          }
          if (input.toolName === "get_app_state")
            return await observe(
              appReference(args.app_ref),
              args.include_screenshot === true,
              session,
              operation,
            );
          return await act(input.toolName, args, session, operation);
        });
      } catch (error) {
        return nativeFailure(error, operation);
      }
    },
    async closeSession(context) {
      await close(getSession(context));
    },
    async dispose() {
      if (disposal) return await disposal;
      disposed = true;
      for (const session of sessions.values()) {
        session.closed = true;
        session.controller.abort();
      }
      disposal = serialize(async () => {
        // teardown 必须回收 handle；已中断的远端会话结束失败不能阻止本地释放。
        for (const session of sessions.values()) {
          try {
            await end(session);
          } catch {
            clear(session);
          }
        }
        try {
          await releaseClient();
        } finally {
          sessions.clear();
        }
      });
      return await disposal;
    },
  };
}
