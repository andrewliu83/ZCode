import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputerUseRuntime, ComputerUseRuntimeContext } from "../index.js";

const mocks = vi.hoisted(() => ({ load: vi.fn(), broker: vi.fn() }));
vi.mock("../driver-sdk.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../driver-sdk.js")>()),
  loadDriverSdk: mocks.load,
}));
vi.mock("../broker.js", () => ({ callBrokerMethod: mocks.broker }));
import { createComputerUseRuntime } from "../index.js";

const context: ComputerUseRuntimeContext = {
  sessionId: "private-session",
  workspaceKey: "private-workspace",
  runtimeScope: "main",
  workspaceIdentity: "private-identity",
  remoteSessionId: "private-remote",
};
const appRef = { pid: 42, bundle_id: "test.fixture", window_id: 9007199254740991 };
const apps = [
  { pid: 42, bundle_id: "test.fixture", name: "Fixture", running: true, active: false },
];
const windows = [
  {
    pid: 42,
    window_id: appRef.window_id,
    title: "Fixture",
    bounds: { x: -100, y: 5, width: 200, height: 100 },
    is_on_screen: true,
  },
];
const snapshot = {
  pid: 42,
  window_id: appRef.window_id,
  snapshot_id: "s12345678",
  capture_id: "actual-capture",
  screenshot_width: 400,
  screenshot_height: 200,
  screenshot_scale: 2,
  screenshot_frame_valid: true,
  window_bounds: windows[0].bounds,
  tree_markdown: "[3] button Save",
  elements: [
    {
      element_index: 3,
      element_token: "s12345678:3",
      role: "button",
      label: "Save",
      value: "initial",
      actions: ["press", "showmenu"],
      screenshot_frame: { x: 10, y: 20, w: 100, h: 40 },
    },
  ],
};
const action = {
  effect: "confirmed",
  route: "accessibility",
  delivery: { mode: "background", delivered_count: 1 },
};
function result(value: unknown, extra = {}) {
  return {
    text: JSON.stringify(value),
    structuredJson: JSON.stringify(value),
    rawJson: "{}",
    images: [],
    isError: false,
    ...extra,
  };
}
function receipt(value: any) {
  return value.structuredContent ?? JSON.parse(value.content[0].text);
}
const runtimes: ComputerUseRuntime[] = [];
let calls: Array<{ name: string; args: any; signal?: AbortSignal }>;
let handler: (name: string, args: any, signal?: AbortSignal) => any;
let client: {
  callTool: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  uniffiDestroy: ReturnType<typeof vi.fn>;
};
function runtime() {
  const value = createComputerUseRuntime({ brokerSocketPath: "/stable-broker", env: {} });
  runtimes.push(value);
  return value;
}
function execute(
  runtime: ComputerUseRuntime,
  toolName: string,
  args: unknown = {},
  ctx = context,
  signal?: AbortSignal,
): Promise<any> {
  return runtime.execute({ toolName, arguments: args, context: ctx, signal });
}
async function observe(runtime: ComputerUseRuntime, includeScreenshot = false, ctx = context) {
  return execute(
    runtime,
    "get_app_state",
    { app_ref: appRef, include_screenshot: includeScreenshot },
    ctx,
  );
}
beforeEach(() => {
  calls = [];
  mocks.broker.mockReset().mockResolvedValue({ socketPath: "/native", generation: "g1", pid: 7 });
  handler = (name) => {
    if (name === "list_apps") return result({ apps });
    if (name === "list_windows") return result({ windows });
    if (name === "get_window_state")
      return result(snapshot, {
        images: [{ mimeType: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAYAAAA=" }],
      });
    if (name === "check_permissions")
      return result({ accessibility: false, screen_recording: true });
    if (name === "end_session") return result({ active: false });
    return result(action, { action });
  };
  client = {
    callTool: vi.fn(async (name, json, options) => {
      const args = JSON.parse(json);
      calls.push({ name, args, signal: options?.signal });
      return handler(name, args, options?.signal);
    }),
    shutdown: vi.fn(async () => {}),
    uniffiDestroy: vi.fn(),
  };
  mocks.load.mockReset().mockResolvedValue({ CuaDriver: { connect: vi.fn(async () => client) } });
});
afterEach(async () => {
  for (const value of runtimes.splice(0)) await value.dispose();
});

describe("Cua Driver runtime adapter", () => {
  it("lazily loads, returns bare inventory arrays and structured SDK-compatible state with sparse indexes", async () => {
    const value = runtime();
    expect(mocks.load).not.toHaveBeenCalled();
    const inventory = await execute(value, "list_apps");
    expect(JSON.parse(inventory.content[0].text)).toEqual(apps);
    const state = await observe(value);
    expect(state.isError).not.toBe(true);
    expect(state.structuredContent).toMatchObject({
      app: { pid: 42, bundle_id: "test.fixture" },
      window: { window_id: appRef.window_id },
      text: snapshot.tree_markdown,
    });
    expect(state.structuredContent.state_id).toContain(snapshot.snapshot_id);
    expect(state.structuredContent.elements[3]).toEqual({
      index: 3,
      kind: "button",
      title: "Save",
      value: "initial",
      actions: ["press", "showmenu"],
      screenshot_frame: { x: 10, y: 20, w: 100, h: 40 },
    });
    const native = calls.find((call) => call.name === "get_window_state")!;
    expect(native.args).toMatchObject({
      pid: 42,
      window_id: appRef.window_id,
      full_output: true,
      tree_format: "both",
      include_accessibility_tree: true,
      include_screenshot: false,
    });
    expect(native.args.session).not.toMatch(/private/u);
    expect(mocks.broker).toHaveBeenCalledWith(
      expect.objectContaining({ socketPath: "/stable-broker", method: "get_driver_connection" }),
    );
  });

  it("maps real tokens, singular modifiers and post-action return_state to a new native observation", async () => {
    const value = runtime();
    await observe(value);
    const output = await execute(value, "left_click", {
      app_ref: appRef,
      target: { type: "element", index: 3 },
      modifiers: "cmd+shift",
      return_state: "full",
    });
    expect(output.isError).not.toBe(true);
    expect(calls.find((call) => call.name === "click")?.args).toEqual({
      target: { kind: "window", pid: 42, window_id: appRef.window_id },
      element_token: "s12345678:3",
      delivery_mode: "background",
      button: "left",
      count: 1,
      modifier: ["cmd", "shift"],
      session: expect.any(String),
    });
    expect(output.structuredContent.action_sent).toBe(true);
    expect(output.structuredContent.elements[3].index).toBe(3);
    expect(calls.filter((call) => call.name === "get_window_state")).toHaveLength(2);
  });

  it("rejects stale element indexes and mismatched state, window, workspace, scope and session before native action", async () => {
    const value = runtime();
    const state = await observe(value);
    const args = {
      app_ref: appRef,
      target: { type: "element", index: 3, state_id: state.structuredContent.state_id },
    };
    for (const ctx of [
      { ...context, sessionId: "other" },
      { ...context, workspaceIdentity: "other" },
      { ...context, runtimeScope: "subagent" as const },
      { ...context, remoteSessionId: "other" },
    ])
      expect((await execute(value, "left_click", args, ctx)).isError).toBe(true);
    expect(
      (await execute(value, "left_click", { ...args, app_ref: { ...appRef, window_id: 2 } }))
        .isError,
    ).toBe(true);
    expect(
      (
        await execute(value, "left_click", {
          ...args,
          target: { ...args.target, state_id: "wrong" },
        })
      ).isError,
    ).toBe(true);
    expect(calls.filter((call) => call.name === "click")).toHaveLength(0);
    await execute(value, "left_click", args);
    const stale = await execute(value, "left_click", args);
    expect(stale.isError).toBe(true);
    expect(receipt(stale).action_sent).toBe(false);
    expect(calls.filter((call) => call.name === "click")).toHaveLength(1);
  });

  it("binds exact capture pixels without adding global origin or dividing by scale and rejects expired/outside frames", async () => {
    const value = runtime();
    const state = await observe(value, true);
    const frame = JSON.parse(
      state.content.find(
        (block: any) => block.type === "text" && block.text.includes('"image_ref"'),
      ).text,
    ).image_ref.frame_id;
    const target = { type: "coordinate", frame_id: frame, x: 399, y: 199 };
    const outside = await execute(value, "left_click", {
      app_ref: appRef,
      target: { ...target, x: 400 },
    });
    expect(outside.isError).toBe(true);
    const output = await execute(value, "left_click", { app_ref: appRef, target });
    expect(output.isError).not.toBe(true);
    expect(calls.find((call) => call.name === "click")?.args).toMatchObject({
      x: 399,
      y: 199,
      capture_id: "actual-capture",
      delivery_mode: "background",
    });
    expect((await execute(value, "left_click", { app_ref: appRef, target })).isError).toBe(true);
  });

  it("never issues actionable frame credentials without actual capture id and validated dimensions", async () => {
    handler = (name) =>
      name === "list_apps"
        ? result({ apps })
        : name === "list_windows"
          ? result({ windows })
          : result({ ...snapshot, capture_id: undefined });
    const output = await observe(runtime(), true);
    expect(output.content.some((block: any) => block.text?.includes('"image_ref"'))).toBe(false);
  });

  it("rejects unsafe numeric identifiers without bigint precision loss", async () => {
    const value = runtime();
    const output = await execute(value, "get_app_state", {
      app_ref: { ...appRef, window_id: Number.MAX_SAFE_INTEGER + 1 },
    });
    expect(output.isError).toBe(true);
    expect(calls).toHaveLength(0);
    handler = (name) =>
      name === "list_apps"
        ? result({ apps })
        : result({ windows: [{ ...windows[0], window_id: Number.MAX_SAFE_INTEGER + 1 }] });
    expect((await execute(value, "list_windows", { app_ref: { pid: 42 } })).isError).toBe(true);
  });

  it("does not choose the first duplicate app or unmarked window", async () => {
    handler = (name) =>
      name === "list_apps"
        ? result({ apps: [...apps, { ...apps[0], pid: 43 }] })
        : result({ windows: [...windows, { ...windows[0], window_id: 2 }] });
    const value = runtime();
    expect((await execute(value, "get_app_state", { app_ref: { name: "Fixture" } })).isError).toBe(
      true,
    );
    expect((await execute(value, "get_app_state", { app_ref: { pid: 42 } })).isError).toBe(true);
    expect(calls.some((call) => call.name === "get_window_state")).toBe(false);
  });

  it("prevents another controller from replacing snapshots and releases control when closed", async () => {
    const first = runtime();
    const second = runtime();
    await observe(first);
    expect(receipt(await observe(second)).code).toBe("controller_busy");
    await first.closeSession(context);
    expect((await observe(second)).isError).not.toBe(true);
  });

  it("aborts before dispatch without loading SDK and prevents late admission after close/dispose", async () => {
    const value = runtime();
    const abort = new AbortController();
    abort.abort();
    expect(receipt(await execute(value, "left_click", {}, context, abort.signal)).action_sent).toBe(
      false,
    );
    expect(mocks.load).not.toHaveBeenCalled();
    await value.closeSession(context);
    expect((await observe(value)).isError).toBe(true);
    await value.dispose();
    expect((await execute(value, "list_apps")).isError).toBe(true);
  });

  it("preserves possibly_sent on cancellation after dispatch and never retries", async () => {
    const value = runtime();
    await observe(value);
    const abort = new AbortController();
    handler = async (name, _args, signal) => {
      if (name !== "click") return result({ active: false });
      abort.abort();
      expect(signal?.aborted).toBe(true);
      throw Object.assign(new Error("Interrupted"), {
        tag: "ActionInterrupted",
        inner: { completion: 2, reason: "cancelled" },
      });
    };
    const output = await execute(
      value,
      "left_click",
      { app_ref: appRef, target: { type: "element", index: 3 } },
      context,
      abort.signal,
    );
    expect(receipt(output)).toMatchObject({ action_sent: true, dispatch_status: "possibly_sent" });
    expect(calls.filter((call) => call.name === "click")).toHaveLength(1);
  });

  it("preserves explicit not-started interruptions and denied action receipts", async () => {
    const value = runtime();
    await observe(value);
    handler = () => {
      throw Object.assign(new Error("not started"), {
        tag: "ActionInterrupted",
        inner: { completion: 0 },
      });
    };
    expect(
      receipt(
        await execute(value, "left_click", {
          app_ref: appRef,
          target: { type: "element", index: 3 },
        }),
      ),
    ).toMatchObject({ action_sent: false, dispatch_status: "not_sent" });
  });

  it("rotates SDK client by broker generation and requires new observation", async () => {
    const value = runtime();
    await observe(value);
    mocks.broker.mockResolvedValue({ socketPath: "/native2", generation: "g2", pid: 8 });
    const output = await execute(value, "left_click", {
      app_ref: appRef,
      target: { type: "element", index: 3 },
    });
    expect(output.isError).toBe(true);
    expect(client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.name === "click")).toBe(false);
    expect((await observe(value)).isError).not.toBe(true);
  });

  it("maps set_value, type, key repeats and advertised secondary actions only", async () => {
    const value = runtime();
    await observe(value);
    await execute(value, "set_value", {
      app_ref: appRef,
      target: { type: "element", index: 3 },
      value: "new",
    });
    expect(calls.find((call) => call.name === "set_value")?.args).toMatchObject({
      pid: 42,
      window_id: appRef.window_id,
      element_token: "s12345678:3",
      value: "new",
    });
    await observe(value);
    await execute(value, "type", { app_ref: appRef, text: "hello" });
    expect(calls.find((call) => call.name === "type_text")?.args).toMatchObject({
      text: "hello",
      delivery_mode: "background",
    });
    await observe(value);
    await execute(value, "key", { app_ref: appRef, text: "cmd+shift+Return", repeat: 2 });
    expect(calls.filter((call) => call.name === "press_key")).toHaveLength(2);
    expect(calls.find((call) => call.name === "press_key")?.args).toMatchObject({
      key: "Return",
      modifiers: ["cmd", "shift"],
      delivery_mode: "background",
    });
    await observe(value);
    await execute(value, "perform_action", {
      app_ref: appRef,
      target: { type: "element", index: 3 },
      action: "Show Menu",
    });
    expect(calls.find((call) => call.name === "click")?.args.action).toBe("show_menu");
  });

  it("refuses unsupported semantics before sending an action", async () => {
    const value = runtime();
    await observe(value);
    for (const [toolName, args] of [
      ["select_text", { target: { type: "element", index: 3 }, text_range: [0, 1] }],
      ["paste", { text: "rich", format: "html" }],
      ["key", { text: "a", hold_seconds: 1 }],
      ["left_click", { target: { type: "element", index: 3 }, strategy: "event" }],
      ["left_click", { target: { type: "element", index: 3 }, strategy: "a11y" }],
      ["perform_action", { target: { type: "element", index: 3 }, action: "invented" }],
      [
        "scroll",
        { target: { type: "element", index: 3 }, scroll_direction: "down", scroll_amount: 1 },
      ],
    ] as const) {
      const output = await execute(value, toolName, { ...args, app_ref: appRef });
      expect(receipt(output)).toMatchObject({ code: "action_unavailable", action_sent: false });
    }
    expect(
      calls.some((call) => ["click", "scroll", "press_key", "type_text"].includes(call.name)),
    ).toBe(false);
  });

  it("queries permissions without prompting and reports denial with structured status", async () => {
    const output = await execute(runtime(), "request_access");
    expect(output.isError).toBe(true);
    expect(receipt(output)).toMatchObject({
      ready: false,
      accessibility: "denied",
      screenRecording: "granted",
      code: "permission_denied",
    });
    expect(calls.find((call) => call.name === "check_permissions")?.args).toMatchObject({
      prompt: false,
      probe_direct_capture: false,
    });
  });

  it("matches real AX-prefixed advertised actions without allowing invented actions", async () => {
    const value = runtime();
    handler = (name) => {
      if (name === "list_apps") return result({ apps });
      if (name === "list_windows") return result({ windows });
      if (name === "get_window_state")
        return result({
          ...snapshot,
          elements: [{ ...snapshot.elements[0], actions: ["AXPress", "AXShowMenu"] }],
        });
      return result(action, { action });
    };
    await observe(value);
    expect(
      (
        await execute(value, "perform_action", {
          app_ref: appRef,
          target: { type: "element", index: 3 },
          action: "Show Menu",
        })
      ).isError,
    ).not.toBe(true);
    expect(calls.find((call) => call.name === "click")?.args.action).toBe("show_menu");
    await observe(value);
    expect(
      (
        await execute(value, "perform_action", {
          app_ref: appRef,
          target: { type: "element", index: 3 },
          action: "AXPress",
        })
      ).isError,
    ).not.toBe(true);
    expect(calls.filter((call) => call.name === "click").at(-1)?.args.action).toBe("press");
    await observe(value);
    expect(
      receipt(
        await execute(value, "perform_action", {
          app_ref: appRef,
          target: { type: "element", index: 3 },
          action: "AXInvented",
        }),
      ),
    ).toMatchObject({ code: "action_unavailable", action_sent: false });
    expect(calls.filter((call) => call.name === "click")).toHaveLength(2);
  });

  it("normalizes legacy inventory fields using only explicit Driver facts and tolerates null app names", async () => {
    const unnamed = { ...apps[0], name: null };
    handler = (name) => {
      if (name === "list_apps") return result({ apps: [unnamed] });
      if (name === "list_windows")
        return result({
          windows: [windows[0], { ...windows[0], window_id: 2, is_main: true, is_key: false }],
        });
      return result(snapshot);
    };
    const value = runtime();
    expect(JSON.parse((await execute(value, "list_apps")).content[0].text)).toEqual([unnamed]);
    const output = JSON.parse(
      (await execute(value, "list_windows", { app_ref: { pid: 42 } })).content[0].text,
    );
    expect(output[0].bounds).toEqual([-100, 5, 200, 100]);
    expect(output[0]).not.toHaveProperty("main");
    expect(output[0]).not.toHaveProperty("focused");
    expect(output[1]).toMatchObject({ main: true, focused: false });
    expect(
      (
        await execute(value, "get_app_state", {
          app_ref: { bundle_id: "test.fixture", window_id: appRef.window_id },
        })
      ).isError,
    ).not.toBe(true);
    expect((await execute(value, "get_app_state", { app_ref: { name: "Fixture" } })).isError).toBe(
      true,
    );
  });

  it("returns the same permission and action protocol for desktop and mobile runtime delivery", async () => {
    const outputs = [];
    for (const mode of ["desktop-continuous", "web-remote-replayable"] as const) {
      const value = runtime();
      const ctx = { ...context, clientMode: mode, deliveryKind: mode };
      handler = (name) => {
        if (name === "list_apps") return result({ apps });
        if (name === "list_windows") return result({ windows });
        if (name === "get_window_state") return result(snapshot);
        if (name === "check_permissions")
          return result({
            accessibility: false,
            screen_recording: true,
            source: { bundle_id: "ai.cua.driver", host_bundle_id: "dev.zcode.host" },
          });
        if (name === "end_session") return result({ active: false });
        return result(action, { action });
      };
      const permissions = await execute(value, "request_access", {}, ctx);
      expect(permissions._meta["zcode.cua/request-access-status-v1"].grantOwner).toBe(
        "ai.cua.driver",
      );
      await observe(value, false, ctx);
      const click = await execute(
        value,
        "left_click",
        { app_ref: appRef, target: { type: "element", index: 3 } },
        ctx,
      );
      outputs.push({ permissions, click });
      await value.closeSession(ctx);
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });

  it("falls back to the native host permission owner when bundle_id is empty", async () => {
    handler = () =>
      result({
        accessibility: true,
        screen_recording: true,
        source: { bundle_id: "", host_bundle_id: "dev.zcode.host" },
      });
    const output = await execute(runtime(), "request_access");
    expect(output.isError).not.toBe(true);
    expect(output._meta["zcode.cua/request-access-status-v1"].grantOwner).toBe("dev.zcode.host");
  });

  it("stops only the owned native session and releases handles without stopping the daemon", async () => {
    const value = runtime();
    await observe(value);
    expect((await execute(value, "stop_computer_control")).isError).not.toBe(true);
    expect(calls.filter((call) => call.name === "end_session")).toHaveLength(1);
    expect((await observe(value)).isError).toBe(true);
    await value.dispose();
    expect(client.uniffiDestroy).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.name === "shutdown")).toBe(false);
  });
});

describe("background input ladder", () => {
  it("retries web-content text behind a screenshot pixel focus and keeps background mode", async () => {
    const value = runtime();
    await observe(value, true);
    handler = (name, args) => {
      if (name !== "type_text") return result(action, { action });
      if (args.element_token) {
        const error = new Error("web content refused");
        error.code = "background_unavailable";
        throw error;
      }
      return result(action, { action });
    };
    const state = await observe(value, true);
    const output = await execute(value, "type", {
      app_ref: appRef,
      target: { type: "element", index: 3, state_id: state.structuredContent.state_id },
      text: "typed",
    });
    expect(output.isError).not.toBe(true);
    const types = calls.filter((call) => call.name === "type_text");
    expect(types).toHaveLength(2);
    expect(types[0].args.element_token).toBe("s12345678:3");
    expect(types[1].args).toMatchObject({ x: 60, y: 40, delivery_mode: "background" });
    const click = calls.find((call) => call.name === "click" && call.args.x === 60);
    expect(click?.args.delivery_mode).toBe("background");
  });

  it("escalates once to foreground only when the driver refuses the background pixel route", async () => {
    const value = runtime();
    const state = await observe(value, true);
    handler = (name, args) => {
      if (name !== "type_text") return result(action, { action });
      if (args.delivery_mode === "foreground") return result(action, { action });
      const error = new Error("keyboard route refused");
      error.code = "background_unavailable";
      throw error;
    };
    const output = await execute(value, "type", {
      app_ref: appRef,
      target: { type: "element", index: 3, state_id: state.structuredContent.state_id },
      text: "typed",
    });
    expect(output.isError).not.toBe(true);
    const types = calls.filter((call) => call.name === "type_text");
    expect(types.at(-1)?.args.delivery_mode).toBe("foreground");
    expect(types.at(-1)?.args).not.toHaveProperty("target");
  });
});
