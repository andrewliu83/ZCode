import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 桌面构建期独立可选能力：自动更新。
 * 优先级：构建进程环境变量 > config/private/build-defaults.json > 关闭。
 * ARMS 和业务事件上传已经删除，旧环境值和私有配置不再解析。
 */
export const PRIVATE_BUILD_DEFAULTS_PATH = resolve(
  import.meta.dirname,
  "../config/private/build-defaults.json",
);

const ENABLED_VALUES = new Set(["1", "true", "yes"]);

async function readPrivateDefaults(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`构建期私有默认配置必须是 JSON 对象：${path}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function pickValue(env, defaults, key) {
  // 环境变量显式设置（包括空字符串）时优先，空字符串表示关闭该项能力
  if (typeof env[key] === "string") return env[key].trim();
  const value = defaults[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveBuildTimeConfig(
  env = process.env,
  { defaultsPath = PRIVATE_BUILD_DEFAULTS_PATH } = {},
) {
  const defaults = await readPrivateDefaults(defaultsPath);
  return {
    autoUpdateEnabled: ENABLED_VALUES.has(
      pickValue(env, defaults, "ZCODE_AUTO_UPDATE").toLowerCase(),
    ),
  };
}

export function createBuildTimeConfigDefines(config) {
  return {
    __ZCODE_AUTO_UPDATE_ENABLED__: JSON.stringify(config.autoUpdateEnabled),
  };
}
