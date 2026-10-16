import { app } from "electron";
import type { AppUpdater } from "electron-updater";

declare const __ZCODE_MAC_UPDATE_MODE__: "native" | "ad-hoc";

export function resolveCommunityUpdater(fallback: AppUpdater): AppUpdater | Promise<AppUpdater> {
  // 未注入标记的测试／开发不启动 app 替换器；Developer ID 包继续使用原生 Squirrel。
  if (
    process.platform === "darwin" &&
    app.isPackaged &&
    typeof __ZCODE_MAC_UPDATE_MODE__ !== "undefined" &&
    __ZCODE_MAC_UPDATE_MODE__ === "ad-hoc"
  ) {
    return import("./communityMacUpdater.js").then(
      ({ CommunityMacUpdater }) => new CommunityMacUpdater(),
    );
  }
  return fallback;
}
