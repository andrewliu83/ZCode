import { CuaHelperError } from "./broker.js";
import { parseDriverResult } from "./driver-sdk.js";

async function rawCall(client, name, args, signal) {
  const output = await client.callTool(name, JSON.stringify(args), { signal });
  if (output.isError) {
    throw new CuaHelperError(output.text || `Cua Driver ${name} failed.`, {
      code: output.errorCode,
    });
  }
  return output;
}

export async function callDriverTool(client, name, args, signal) {
  const payload = parseDriverResult(await rawCall(client, name, args, signal));
  if (!payload) throw new CuaHelperError(`Cua Driver ${name} returned no structured data.`);
  return payload;
}

export async function queryDriverPermissions(native, queryOptions, signal) {
  const data = await callDriverTool(
    native.client,
    "check_permissions",
    {
      prompt: false,
      probe_direct_capture: false,
    },
    signal,
  );
  if (
    data.source?.pid !== native.connection.pid ||
    data.source?.bundle_id !== native.identity.bundleId
  ) {
    throw new CuaHelperError("Cua Driver permission source changed.");
  }
  let probe = { ok: false, classification: "not_checked" };
  // 普通轮询只读授权；用户显式请求且 AX 已授权时，才验证实际树读取能力。
  if (queryOptions?.includeFunctionalProbes === true && data.accessibility === true) {
    try {
      const output = await rawCall(native.client, "get_accessibility_tree", {}, signal);
      const structured = parseDriverResult(output);
      // 该工具返回真实 AX 应用/窗口枚举；非空列表或非空文本才证明读到了 UI 元素。
      const apps = Array.isArray(structured?.apps) ? structured.apps : undefined;
      const observed =
        (apps?.length ?? 0) > 0 ||
        (typeof output.text === "string" && output.text.trim().length > 0);
      probe = observed
        ? { ok: true, classification: "functional" }
        : { ok: false, classification: "empty_tree" };
    } catch (error) {
      if (signal.aborted) throw error;
      probe = { ok: false, classification: "read_failed" };
    }
  }
  const permission = (value) =>
    typeof value === "boolean" ? (value ? "granted" : "denied") : "unknown";
  return {
    grant_owner: native.identity.bundleId,
    owner: { display_name: native.identity.displayName },
    accessibility: permission(data.accessibility),
    screen_recording: permission(data.screen_recording),
    accessibility_probe: probe,
    accessibility_probe_ok: probe.ok,
  };
}

export async function queryDriverCapture(native, signal) {
  const permissions = await callDriverTool(
    native.client,
    "check_permissions",
    {
      prompt: false,
      probe_direct_capture: false,
    },
    signal,
  );
  if (
    permissions.source?.pid !== native.connection.pid ||
    permissions.source?.bundle_id !== native.identity.bundleId ||
    permissions.screen_recording !== true
  ) {
    return { ok: false, reason: "Screen Recording permission is not granted for this Driver." };
  }
  try {
    // 仅由显式探针入口截图，不写文件、不返回像素，也不把结构化成功标志当作捕获证据。
    const output = await rawCall(
      native.client,
      "get_desktop_state",
      { max_image_dimension: 64 },
      signal,
    );
    for (const image of output.images ?? []) {
      if (image.mimeType !== "image/png" || typeof image.dataBase64 !== "string") continue;
      const png = Buffer.from(image.dataBase64, "base64");
      if (
        png.length >= 33 &&
        png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        png.readUInt32BE(8) === 13 &&
        png.toString("ascii", 12, 16) === "IHDR" &&
        png.readUInt32BE(16) > 0 &&
        png.readUInt32BE(20) > 0
      ) {
        return { ok: true };
      }
    }
    return { ok: false, reason: "Cua Driver did not return a PNG with valid dimensions." };
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, reason: "Cua Driver screen capture failed." };
  }
}
