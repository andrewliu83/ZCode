import { createRuntime } from "./runtime.js";

const METHODS = new Set([
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "request_access",
  "stop_computer_control",
]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { code, details });
};
const textBlock = (value) => ({ type: "text", text: JSON.stringify(value) });
const envelope = (value, isError = false) => ({
  content: [textBlock(value)],
  ...(record(value) ? { structuredContent: value } : {}),
  ...(isError ? { isError: true } : {}),
});
function safeId(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    fail("invalid_request", `${label} must be a safe integer >= ${minimum}.`);
  return value;
}
function appReference(value) {
  const ref = typeof value === "string" ? { bundle_id: value } : value;
  if (!record(ref)) fail("invalid_request", "app_ref must identify an application.");
  if (ref.pid !== undefined) safeId(ref.pid, "pid", 1);
  if (ref.window_id !== undefined) safeId(ref.window_id, "window_id");
  for (const key of ["name", "bundle_id"]) {
    if (ref[key] !== undefined && (typeof ref[key] !== "string" || !ref[key].trim()))
      fail("invalid_request", `${key} must be non-empty text.`);
  }
  if (ref.pid === undefined && ref.name === undefined && ref.bundle_id === undefined)
    fail("invalid_request", "app_ref needs pid, bundle_id or name.");
  return ref;
}
function contextKey(context) {
  if (
    !record(context) ||
    typeof context.sessionId !== "string" ||
    !context.sessionId ||
    !["main", "subagent"].includes(context.runtimeScope)
  )
    fail("invalid_request", "A valid Computer Use session context is required.");
  const workspace =
    context.workspaceIdentity?.trim() || context.workspacePath || context.workspaceKey;
  if (typeof workspace !== "string" || !workspace)
    fail("invalid_request", "A workspace identity is required.");
  return JSON.stringify([
    workspace,
    context.sessionId,
    context.runtimeScope,
    context.remoteSessionId ?? "",
  ]);
}
function modifiers(value) {
  if (value === undefined) return [];
  const values = typeof value === "string" ? value.split("+") : value;
  if (!Array.isArray(values) || values.some((item) => typeof item !== "string"))
    fail("invalid_request", "modifiers must be a chord or an array of keys.");
  const keys = values.map((key) => key.trim().toLowerCase());
  if (keys.some((key) => !["cmd", "shift", "option", "alt", "ctrl", "fn"].includes(key)))
    fail("action_unavailable", "The requested modifier is unsupported.");
  return [...new Set(keys)];
}
function validateArguments(tool, args) {
  if (!METHODS.has(tool)) fail("method_not_found", `Unknown Computer Use tool: ${tool}.`);
  if (!record(args)) fail("invalid_request", "Tool arguments must be an object.");
  if (args.app_ref !== undefined) appReference(args.app_ref);
  if (
    [
      "get_app_state",
      "left_click",
      "left_click_drag",
      "scroll",
      "type",
      "key",
      "set_value",
      "perform_action",
    ].includes(tool) &&
    args.app_ref === undefined
  )
    fail("invalid_request", "app_ref is required.");
  if (args.strategy !== undefined && args.strategy !== "auto")
    fail("action_unavailable", "The Driver cannot guarantee an exclusive a11y/event strategy.");
  if (["select_text", "paste", "scroll"].includes(tool))
    fail(
      "action_unavailable",
      "The Driver cannot preserve this tool's selection, clipboard or targeted page-scroll semantics.",
    );
  if (args.hold_seconds !== undefined)
    fail("action_unavailable", "Held-key duration is unsupported.");
  if (args.return_state !== undefined && ![false, true, "none", "full"].includes(args.return_state))
    fail("action_unavailable", "Only a full post-action state is supported.");
  if (["type", "key"].includes(tool) && typeof args.text !== "string")
    fail("invalid_request", "text must be a string.");
  if (tool === "set_value" && typeof args.value !== "string")
    fail("invalid_request", "value must be a string.");
  if (tool === "key") {
    const parts = args.text.split("+");
    if (!parts.at(-1)?.trim()) fail("invalid_request", "A key is required.");
    modifiers(parts.slice(0, -1));
    const repeat = args.repeat ?? 1;
    safeId(repeat, "repeat", 1);
    if (repeat > 100) fail("invalid_request", "repeat must be <= 100.");
  }
  if (["left_click", "left_click_drag"].includes(tool)) modifiers(args.modifiers);
  if (tool === "left_click") {
    if (!["left", "right", "middle"].includes(args.mouse_button ?? "left"))
      fail("invalid_request", "Unsupported mouse button.");
    safeId(args.click_count ?? 1, "click_count", 1);
    if ((args.click_count ?? 1) > 3)
      fail("action_unavailable", "Only click counts 1 through 3 are supported.");
  }
  if (
    tool === "get_app_state" &&
    args.include_screenshot !== undefined &&
    typeof args.include_screenshot !== "boolean"
  )
    fail("invalid_request", "include_screenshot must be boolean.");
}
function nativeFailure(error, operation) {
  const completion = error?.tag === "ActionInterrupted" ? error.inner?.completion : undefined;
  // 取消只能依据 Driver 的完成状态回退为未投递，不能把已投递的异常当成安全重试。
  const sent =
    operation.sent ||
    completion === 1 ||
    (operation.dispatched &&
      completion !== 0 &&
      !["Tool", "InvalidArguments"].includes(error?.tag));
  const status =
    completion === 1 || (operation.sent && !operation.dispatched)
      ? "completed"
      : sent
        ? "possibly_sent"
        : "not_sent";
  const code =
    typeof error?.code === "string"
      ? error.code
      : error?.tag === "ActionInterrupted" || operation.signal?.aborted
        ? "cancelled"
        : "internal";
  return envelope(
    {
      code,
      message: error?.message || error?.inner?.reason || "Cua Driver failed.",
      ...error?.details,
      action_sent: sent,
      dispatch_status: status,
    },
    true,
  );
}
function checkLive(session, disposed, signal) {
  if (disposed || session.closed)
    fail("not_authorized", "Computer control has stopped for this session.");
  if (signal?.aborted) fail("cancelled", "Computer Use was cancelled before dispatch.");
}
function validBounds(bounds) {
  return (
    record(bounds) &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(bounds[key])) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}
function pngDimensions(image) {
  if (image?.mimeType !== "image/png" || typeof image.dataBase64 !== "string") return undefined;
  const bytes = Buffer.from(image.dataBase64, "base64");
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function createComputerUseRuntime(options = {}) {
  return createRuntime(options, {
    record,
    fail,
    textBlock,
    envelope,
    safeId,
    appReference,
    contextKey,
    modifiers,
    validateArguments,
    nativeFailure,
    checkLive,
    validBounds,
    pngDimensions,
  });
}
