import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createBuildTimeConfigDefines, resolveBuildTimeConfig } from "../build-time-config.mjs";

const dir = await mkdtemp(join(tmpdir(), "zcode-build-time-config-"));
after(() => rm(dir, { recursive: true, force: true }));
async function writeDefaults(name, content) {
  const path = join(dir, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

test("没有私有配置时自动更新默认关闭，已移除上报能力不再返回配置", async () => {
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath: join(dir, "missing.json") }), {
    autoUpdateEnabled: false,
  });
});

test("历史私有上报配置被忽略，独立的自动更新仍可启用", async () => {
  const defaultsPath = await writeDefaults("defaults.json", {
    ZCODE_ARMS_RUM_ENDPOINT: "https://rum.example.com/x",
    ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    ZCODE_AUTO_UPDATE: "1",
  });
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath }), { autoUpdateEnabled: true });
});

test("环境变量不能恢复已移除的上报，自动更新环境值仍优先", async () => {
  const defaultsPath = await writeDefaults("override.json", { ZCODE_AUTO_UPDATE: "true" });
  assert.deepEqual(
    await resolveBuildTimeConfig(
      {
        ZCODE_ARMS_RUM_ENDPOINT: "https://rum.example.com/x",
        ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
        ZCODE_PACKAGED_AGENT_OTEL_ENDPOINT: "https://otlp.example.com",
        ZCODE_AUTO_UPDATE: "0",
      },
      { defaultsPath },
    ),
    { autoUpdateEnabled: false },
  );
});

test("私有默认配置格式错误时仍报告配置错误", async () => {
  const defaultsPath = await writeDefaults("broken.json", "[1]");
  await assert.rejects(resolveBuildTimeConfig({}, { defaultsPath }), /必须是 JSON 对象/);
});

test("构建 define 只注入保留的独立能力", () => {
  assert.deepEqual(createBuildTimeConfigDefines({ autoUpdateEnabled: true }), {
    __ZCODE_AUTO_UPDATE_ENABLED__: "true",
  });
});
