const SECONDARY_ACTIONS = new Map([
  ["press", "press"],
  ["showmenu", "show_menu"],
  ["pick", "pick"],
  ["confirm", "confirm"],
  ["cancel", "cancel"],
  ["open", "open"],
  ["showalternateui", "show_alternate_ui"],
  ["showdefaultui", "show_default_ui"],
]);
// 原生 AX 树宣告 AXPress/AXShowMenu，旧 API 使用 Press/Show Menu；匹配同一动作名。
const actionName = (value) =>
  typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[\s_-]/gu, "")
        .replace(/^ax/u, "")
    : "";

export function createRuntimeActions({
  helpers,
  call,
  lease,
  observe,
  getGeneration,
  targetKey,
  policy = {},
}) {
  const { record, fail, safeId, appReference, modifiers, envelope } = helpers;
  // 后台输入阶梯：AX 写入 → 后台像素聚焦后输入 → （仅显式策略）短暂前台。
  const backgroundFocus = policy.backgroundFocus ?? "auto";
  const foregroundEscalation = policy.foregroundEscalation ?? "never";
  function freshState(app, window, session, args) {
    const stored = session.states.get(targetKey(app, window));
    if (!stored || stored.generation !== getGeneration())
      fail("element_unavailable", "Observe this exact window again before acting.");
    if (args.state_id !== undefined && args.state_id !== stored.state.state_id)
      fail("element_unavailable", "The requested state has expired.");
    return stored;
  }
  function position(target, stored) {
    if (!record(target)) fail("invalid_request", "A target is required.");
    if (target.state_id !== undefined && target.state_id !== stored.state.state_id)
      fail("element_unavailable", "The target state has expired.");
    if (target.type === "element") {
      safeId(target.index, "element index");
      const token = stored.tokens.get(target.index);
      if (!token)
        fail("element_unavailable", "The element has no real token in the current snapshot.");
      return { element_token: token };
    }
    if (target.type === "coordinate") {
      const frame = stored.frame;
      if (!frame || (target.frame_id !== undefined && target.frame_id !== frame.id))
        fail(
          "element_unavailable",
          "The screenshot frame has expired or belongs to another window.",
        );
      safeId(target.x, "x");
      safeId(target.y, "y");
      if (target.x >= frame.width || target.y >= frame.height)
        fail("invalid_request", "Coordinates are outside the captured raster.");
      return { x: target.x, y: target.y, capture_id: frame.capture };
    }
    fail("invalid_request", "Unsupported target type.");
  }
  // 元素在当前截图中的像素中心；后台像素聚焦必须使用真实栅格坐标。
  function focusPoint(target, stored) {
    if (target?.type !== "element") return undefined;
    const frame = stored.state.elements[target.index]?.screenshot_frame;
    if (!record(frame)) return undefined;
    const x = frame.x + frame.w / 2;
    const y = frame.y + frame.h / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return undefined;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return async function act(tool, args, session, operation) {
    const ref = appReference(args.app_ref);
    // 动作使用本会话观察过的真实身份；额外枚举不能替代快照，也不能重新绑定到别的窗口。
    const observed = [...session.states.values()].filter(
      ({ state }) =>
        (ref.pid === undefined || state.app.pid === ref.pid) &&
        (ref.bundle_id === undefined || state.app.bundle_id === ref.bundle_id) &&
        (ref.name === undefined || state.app.name?.toLowerCase() === ref.name.toLowerCase()) &&
        (ref.window_id === undefined || state.window.window_id === ref.window_id),
    );
    if (observed.length !== 1)
      fail("element_unavailable", "Observe an exact, unambiguous window before acting.");
    const { app, window } = observed[0].state;
    lease(app, window, session);
    const stored = freshState(app, window, session, args);
    const target = { kind: "window", pid: app.pid, window_id: window.window_id };
    const common = { target, delivery_mode: "background", session: session.label };
    let name;
    let native;
    let repeat = 1;
    if (tool === "left_click" || tool === "perform_action") {
      const pos = position(args.target, stored);
      if (pos.element_token && (args.click_count ?? 1) !== 1)
        fail(
          "action_unavailable",
          "Repeated element clicks cannot preserve pixel click-count semantics.",
        );
      name = "click";
      native = {
        target,
        ...pos,
        delivery_mode: "background",
        button: args.mouse_button ?? "left",
        count: args.click_count ?? 1,
      };
      const modifier = modifiers(args.modifiers);
      if (modifier.length) native.modifier = modifier;
      if (tool === "perform_action") {
        const requested = actionName(args.action);
        const advertised = stored.state.elements[args.target.index]?.actions;
        const action = SECONDARY_ACTIONS.get(requested);
        if (
          !pos.element_token ||
          !action ||
          !Array.isArray(advertised) ||
          !advertised.some((item) => actionName(item) === requested)
        )
          fail(
            "action_unavailable",
            "Only an advertised, supported element action can be performed.",
          );
        native.action = action;
      }
      native.session = session.label;
    } else if (tool === "set_value") {
      const pos = position(args.target, stored);
      if (!pos.element_token)
        fail("action_unavailable", "set_value requires an accessibility element.");
      name = "set_value";
      native = {
        pid: app.pid,
        window_id: window.window_id,
        ...pos,
        value: args.value,
        session: session.label,
      };
    } else if (tool === "type" || tool === "key") {
      if (tool === "type") {
        name = "type_text";
        native = { ...common, text: args.text };
      } else {
        const parts = args.text.split("+").map((part) => part.trim());
        name = "press_key";
        native = { ...common, key: parts.at(-1), modifiers: modifiers(parts.slice(0, -1)) };
        repeat = args.repeat ?? 1;
      }
      if (args.target !== undefined) {
        const pos = position(args.target, stored);
        native.element_token = pos.element_token;
        native.focus = focusPoint(args.target, stored);
      }
    } else if (tool === "left_click_drag") {
      const from = position(args.from_target, stored);
      const to = position(args.to, stored);
      if (from.element_token || to.element_token)
        fail("action_unavailable", "Dragging requires two exact raster coordinates.");
      // drag 没有 capture_id 参数，先通过 since 确认快照仍是当前窗口的同一版本。
      const { data } = await call(
        "get_window_state",
        {
          pid: app.pid,
          window_id: window.window_id,
          since: stored.snapshot,
          tree_format: "both",
          include_accessibility_tree: true,
          include_screenshot: false,
          session: session.label,
        },
        session,
        operation,
      );
      session.states.delete(targetKey(app, window));
      if (
        data?.pid !== app.pid ||
        data?.window_id !== window.window_id ||
        data?.since !== stored.snapshot ||
        data?.since_status !== "no_change"
      )
        fail("element_unavailable", "The window changed; take a new screenshot before dragging.");
      name = "drag";
      native = {
        ...common,
        from_x: from.x,
        from_y: from.y,
        to_x: to.x,
        to_y: to.y,
        modifier: modifiers(args.modifiers),
      };
    } else fail("action_unavailable", "This action has no equivalent Driver operation.");
    session.states.delete(targetKey(app, window));
    const focus = native.focus;
    delete native.focus;
    const attempt = async (payload) => {
      for (let index = 0; index < repeat; index += 1)
        await call(name, payload, session, operation, true);
    };
    const canEscalate = foregroundEscalation === "explicit";
    try {
      await attempt(native);
    } catch (error) {
      if (error?.code !== "background_unavailable" || backgroundFocus !== "auto") throw error;
      // 当前快照可能来自无截图的观察；补一次带像素的观察以取得可靠聚焦点。
      let point = focus;
      if (!point) {
        await observe(ref, true, session, operation);
        const refreshed = session.states.get(targetKey(app, window));
        const frame = refreshed?.state.elements?.[args.target?.index]?.screenshot_frame;
        if (!record(frame)) throw error;
        point = { x: Math.round(frame.x + frame.w / 2), y: Math.round(frame.y + frame.h / 2) };
      }
      // 网页内容的后台 AX 写入会被明确拒绝；先用截图坐标做一次后台像素聚焦，
      // 再输入纯文本/按键（单次调用内的隐式聚焦在 Electron 上不可靠）。
      await call(
        "click",
        {
          target,
          x: point.x,
          y: point.y,
          delivery_mode: "background",
          button: "left",
          count: 1,
          session: session.label,
          ...(stored.frame ? { capture_id: stored.frame.capture } : {}),
        },
        session,
        operation,
        true,
      );
      const pixel = { ...native };
      delete pixel.element_token;
      Object.assign(pixel, point, { delivery_mode: "background" });
      try {
        await attempt(pixel);
      } catch (retryError) {
        if (retryError?.code !== "background_unavailable" || !canEscalate) throw retryError;
        // 系统层仍拒绝后台键盘路由时，才按驱动建议短暂前台并恢复；仅限该次动作。
        const foreground = { ...native, window_id: window.window_id, delivery_mode: "foreground" };
        delete foreground.target;
        await attempt(foreground);
      }
    }
    const receipt = { action_sent: true, dispatch_status: "completed", action: operation.action };
    if (args.return_state === true || args.return_state === "full") {
      const output = await observe(ref, false, session, operation);
      Object.assign(output.structuredContent, receipt);
      return output;
    }
    return envelope(receipt);
  };
}
