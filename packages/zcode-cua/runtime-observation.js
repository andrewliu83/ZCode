import { randomUUID } from "node:crypto";

export const targetKey = (app, window) => `${app.pid}:${window.window_id}`;

export function createRuntimeObservation({ helpers, call, lease, getGeneration }) {
  const { record, fail, safeId, textBlock, validBounds, pngDimensions } = helpers;
  async function inventory(session, operation) {
    const { data } = await call("list_apps", {}, session, operation);
    const apps = Array.isArray(data) ? data : data?.apps;
    if (!Array.isArray(apps)) fail("internal", "Driver returned no application inventory.");
    for (const app of apps) {
      // 原生 inventory 的 name 可为空；精确 pid/bundle_id 仍可解析，不能因此拒绝整份列表。
      if (!record(app) || (app.name != null && typeof app.name !== "string"))
        fail("internal", "Driver returned an invalid application.");
      safeId(app.pid, "application pid");
    }
    return apps.map((app) => ({ ...app, name: app.name ?? null }));
  }
  async function resolveApp(ref, session, operation, launch = false) {
    const apps = await inventory(session, operation);
    const matches = apps.filter(
      (app) =>
        (ref.pid === undefined || app.pid === ref.pid) &&
        (ref.bundle_id === undefined || app.bundle_id === ref.bundle_id) &&
        (ref.name === undefined || app.name?.toLowerCase() === ref.name.toLowerCase()),
    );
    if (matches.length !== 1)
      fail(
        "invalid_request",
        matches.length
          ? "Multiple applications matched; choose an exact pid."
          : "target app is not running, and no installed application matched the reference.",
      );
    const app = matches[0];
    if (app.running === false || app.pid === 0) {
      if (!launch || ref.pid !== undefined) fail("invalid_request", "target app is not running.");
      if (!app.bundle_id && !app.name)
        fail("invalid_request", "The installed application has no launch identifier.");
      // 仅对 inventory 唯一识别的已安装应用调用后台启动，不推测名称或抢占前台。
      await call(
        "launch_app",
        {
          ...(app.bundle_id ? { bundle_id: app.bundle_id } : { name: app.name }),
          session: session.label,
        },
        session,
        operation,
      );
      return await resolveApp(ref, session, operation, false);
    }
    safeId(app.pid, "application pid", 1);
    return app;
  }
  async function windows(app, session, operation) {
    const { data } = await call("list_windows", app ? { pid: app.pid } : {}, session, operation);
    const list = Array.isArray(data) ? data : data?.windows;
    if (!Array.isArray(list)) fail("internal", "Driver returned no window inventory.");
    for (const window of list) {
      if (!record(window)) fail("internal", "Driver returned an invalid window.");
      safeId(window.window_id, "window_id");
      if (window.pid !== undefined) safeId(window.pid, "window pid", 1);
    }
    const selected = app
      ? list.filter((window) => window.pid === undefined || window.pid === app.pid)
      : list;
    return selected.map((window) => {
      // 只映射 Driver 明确给出的几何与主/焦点标记；屏幕顺序不证明 AX main/key 身份。
      const bounds = validBounds(window.bounds)
        ? [window.bounds.x, window.bounds.y, window.bounds.width, window.bounds.height]
        : window.bounds;
      const main = typeof window.main === "boolean" ? window.main : window.is_main;
      const focused = typeof window.focused === "boolean" ? window.focused : window.is_key;
      return {
        ...window,
        bounds,
        ...(typeof main === "boolean" ? { main } : {}),
        ...(typeof focused === "boolean" ? { focused } : {}),
      };
    });
  }
  async function resolveWindow(ref, session, operation, launch = false) {
    const app = await resolveApp(ref, session, operation, launch);
    const list = await windows(app, session, operation);
    let candidates =
      ref.window_id === undefined
        ? list
        : list.filter((window) => window.window_id === ref.window_id);
    if (candidates.length > 1 && ref.window_id === undefined)
      candidates = candidates.filter((window) => window.main === true || window.focused === true);
    if (candidates.length !== 1)
      fail(
        "element_unavailable",
        "Choose an exact window_id from list_windows; no unique primary window is available.",
      );
    const window = candidates[0];
    lease(app, window, session);
    return { app, window };
  }
  async function observe(ref, includeScreenshot, session, operation) {
    const { app, window } = await resolveWindow(ref, session, operation, true);
    const key = targetKey(app, window);
    // 旧凭证必须在发起新快照前失效；读取失败也不能继续使用已被 Driver 替换的 token。
    session.states.delete(key);
    const { data, result } = await call(
      "get_window_state",
      {
        pid: app.pid,
        window_id: window.window_id,
        full_output: true,
        tree_format: "both",
        include_accessibility_tree: true,
        include_screenshot: includeScreenshot,
        session: session.label,
      },
      session,
      operation,
    );
    if (
      !record(data) ||
      data.pid !== app.pid ||
      data.window_id !== window.window_id ||
      typeof data.snapshot_id !== "string" ||
      !data.snapshot_id ||
      !Array.isArray(data.elements) ||
      typeof data.tree_markdown !== "string"
    )
      fail("element_unavailable", "Driver returned no structured snapshot for the exact window.");
    const elements = [];
    const tokens = new Map();
    for (const element of data.elements) {
      if (!record(element)) fail("element_unavailable", "Invalid snapshot element.");
      const index = safeId(element.element_index, "element index");
      if (index > 1_000_000 || Object.hasOwn(elements, index))
        fail("element_unavailable", "Invalid or duplicate snapshot element index.");
      elements[index] = {
        index,
        kind: element.role,
        ...(element.label !== undefined ? { title: element.label } : {}),
        ...(element.value !== undefined ? { value: element.value } : {}),
        ...(element.actions !== undefined ? { actions: element.actions } : {}),
        // 后台输入的第二级（像素聚焦）需要元素在当前截图中的像素框。
        ...(record(element.screenshot_frame) ? { screenshot_frame: element.screenshot_frame } : {}),
        ...(element.in_web_content === true ? { in_web_content: true } : {}),
      };
      if (
        typeof element.element_token === "string" &&
        element.element_token === `${data.snapshot_id}:${index}`
      )
        tokens.set(index, element.element_token);
    }
    const state = {
      app,
      window,
      state_id: `${session.label}:${randomUUID()}:${data.snapshot_id}`,
      elements,
      text: data.tree_markdown,
      snapshot_mode: "full",
      has_image: false,
    };
    const stored = { state, tokens, generation: getGeneration(), snapshot: data.snapshot_id };
    const content = [{ type: "text", text: data.tree_markdown }];
    if (includeScreenshot) {
      const image = result.images?.find((item) => item.mimeType === "image/png");
      const dimensions = pngDimensions(image);
      const bounds = data.window_bounds;
      const scale = data.screenshot_scale;
      if (image) {
        content.push({ type: "image", mimeType: image.mimeType, data: image.dataBase64 });
        state.has_image = true;
      }
      // capture_id 和 PNG IHDR 是坐标授权依据；不能用窗口 bounds 或缩放倍率捏造栅格。
      if (
        typeof data.capture_id === "string" &&
        data.capture_id &&
        data.screenshot_frame_valid === true &&
        dimensions &&
        dimensions.width > 0 &&
        dimensions.height > 0 &&
        dimensions.width === data.screenshot_width &&
        dimensions.height === data.screenshot_height &&
        validBounds(bounds) &&
        Number.isFinite(scale) &&
        scale > 0 &&
        Math.abs(bounds.width * scale - dimensions.width) <= 1 &&
        Math.abs(bounds.height * scale - dimensions.height) <= 1
      ) {
        stored.frame = {
          id: `${session.label}:${randomUUID()}`,
          capture: data.capture_id,
          ...dimensions,
        };
        content.push(
          textBlock({
            image_ref: {
              frame_id: stored.frame.id,
              width: dimensions.width,
              height: dimensions.height,
            },
          }),
        );
      } else
        state.non_actionable_reason = "No validated capture id and raster geometry were returned.";
    }
    session.states.set(key, stored);
    return { content, structuredContent: state };
  }
  return { inventory, resolveApp, windows, observe };
}
