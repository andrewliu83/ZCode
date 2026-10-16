import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDeviceMid } from "../src/deviceIdentity.js";
import { setDataBaseDir } from "../src/paths.js";
import { buildZCodeSourceHeaders } from "../src/providers/sourceHeaders.js";

const tempDirs: string[] = [];
afterEach(async () => {
  setDataBaseDir(null);
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function isolated() {
  const homeDir = await mkdtemp(join(tmpdir(), "zcode-device-identity-"));
  tempDirs.push(homeDir);
  setDataBaseDir(homeDir);
  return { homeDir, stateFile: join(homeDir, ".zcode", "v2", "telemetry-state.json") };
}

describe("local device identity", () => {
  it("新主机只生成本地身份，正常账号请求头复用同一个值", async () => {
    const { stateFile } = await isolated();
    const fetchImpl = vi.fn(() => {
      throw new Error("Device identity must not send network requests");
    });
    vi.stubGlobal("fetch", fetchImpl);
    expect(buildZCodeSourceHeaders()["X-Device-Mid"]).toBeUndefined();
    const value = await ensureDeviceMid();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toEqual({ deviceMid: value });
    expect(buildZCodeSourceHeaders()["X-Device-Mid"]).toBe(value);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("沿用已有身份，不改写旧文件或更新历史上报状态", async () => {
    const { stateFile } = await isolated();
    await mkdir(dirname(stateFile), { recursive: true });
    const existing = JSON.stringify(
      { deviceMid: "existing-device-mid", lastDailyActiveDate: "2026-09-12" },
      null,
      2,
    );
    await writeFile(stateFile, existing);
    await expect(ensureDeviceMid()).resolves.toBe("existing-device-mid");
    expect(await readFile(stateFile, "utf8")).toBe(existing);
  });

  it("并发确保只生成一个身份，不需要上报核心参与", async () => {
    const { homeDir, stateFile } = await isolated();
    const createId = vi.fn(() => "concurrent-device-id");
    const values = await Promise.all(
      Array.from({ length: 12 }, () => ensureDeviceMid({ homeDir, randomUUID: createId })),
    );
    expect(new Set(values)).toEqual(new Set(["concurrent-device-id"]));
    expect(createId).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toEqual({
      deviceMid: "concurrent-device-id",
    });
  });
});
