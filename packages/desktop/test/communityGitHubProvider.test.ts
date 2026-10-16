import { afterEach, describe, expect, it, vi } from "vitest";
import semver from "semver";
import type { AppUpdater } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import { findFile } from "electron-updater/out/providers/Provider.js";
import { CommunityGitHubProvider } from "../src/main/communityGitHubProvider.js";

const stable = "community-v0.1.1";
const preview = "community-v0.2.0-beta.1";
const entry = (tag: string) =>
  `<entry><title>${tag}</title><link href="https://github.com/andrewliu83/ZCode/releases/tag/${tag}"/><content>Fixture release</content></entry>`;

function fixture(
  channel: "stable" | "preview",
  wrongTag = false,
  platform: "darwin" | "win32" | "linux" = "darwin",
) {
  const request = vi.fn(async (options: { path?: string; headers?: Record<string, string> }) => {
    const path = options.path ?? "";
    if (path.includes("releases.atom")) return `<feed>${entry(preview)}${entry(stable)}</feed>`;
    if (path.split("?")[0]?.endsWith("/latest"))
      return JSON.stringify({ tag_name: wrongTag ? "v3.15.2" : stable });
    const version = path.includes(preview) ? "0.2.0-beta.1" : "0.1.1";
    const names =
      platform === "darwin"
        ? [`zcode-community-${version}-mac-arm64.zip`]
        : platform === "win32"
          ? [`zcode-community-${version}-win-x64.exe`]
          : ["AppImage", "deb", "rpm"].map((ext) => `zcode-community-${version}-linux-x64.${ext}`);
    return `version: ${version}\nfiles:\n${names.map((name) => `  - url: ${name}\n    sha512: fixture\n`).join("")}`;
  });
  const updater = {
    allowPrerelease: false,
    allowDowngrade: false,
    fullChangelog: false,
    channel: null,
    currentVersion: semver.parse("0.1.0"),
  } as unknown as AppUpdater;
  const provider = new CommunityGitHubProvider(
    {
      provider: "custom",
      updateProvider: CommunityGitHubProvider,
      resolveReleaseChannel: () => channel,
    },
    updater,
    { platform, executor: { request } } as unknown as ProviderRuntimeOptions,
  );
  return { provider, request, updater };
}

describe("Community GitHub update source", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["stable", "preview"] as const)(
    "uses the original GitHub parser with the Community tag prefix (%s)",
    async (channel) => {
      const { provider, request, updater } = fixture(channel);
      const info = await provider.getLatestVersion();
      expect(info.tag).toBe(channel === "preview" ? preview : stable);
      expect(info).toMatchObject({ zcodeReleaseChannel: channel });
      expect(provider.resolveFiles(info)[0]!.url.href).toContain(
        `/andrewliu83/ZCode/releases/download/${info.tag}/zcode-community-`,
      );
      expect(
        request.mock.calls.every(([options]) => !options.path?.includes("api/v1/releases")),
      ).toBe(true);
      expect(updater.allowDowngrade).toBe(false);
    },
  );
  it.each([
    ["win32", "latest.yml", [".exe"]],
    ["linux", "latest-linux.yml", [".AppImage", ".deb", ".rpm"]],
  ] as const)(
    "resolves the %s feed and every native installer format",
    async (platform, manifest, extensions) => {
      // 在 ARM Mac 上验证 x64 Linux feed，显式使用更新器提供的测试架构入口。
      vi.stubEnv("TEST_UPDATER_ARCH", "x64");
      const { provider, request } = fixture("stable", false, platform);
      const info = await provider.getLatestVersion();
      const files = provider.resolveFiles(info);
      for (const extension of extensions)
        expect(findFile(files, extension.slice(1))?.url.pathname.endsWith(extension)).toBe(true);
      expect(
        request.mock.calls.some(([options]) => options.path?.split("?")[0]?.endsWith(manifest)),
      ).toBe(true);
      expect(
        files.every((file) => file.url.pathname.includes(`/community-v${info.version}/`)),
      ).toBe(true);
    },
  );

  it("does not forward the persistent staging identifier to GitHub", async () => {
    const { provider, request } = fixture("stable");
    provider.setRequestHeaders({
      "X-User-Staging-Id": "private-fixture-id",
      "User-Agent": "Community",
    });
    await provider.getLatestVersion();
    expect(request.mock.calls.length).toBeGreaterThan(0);
    for (const [options] of request.mock.calls) {
      expect(
        Object.keys(options.headers ?? {}).some(
          (name) => name.toLowerCase() === "x-user-staging-id",
        ),
      ).toBe(false);
      expect(JSON.stringify(options)).not.toContain("private-fixture-id");
    }
  });

  it("rejects update assets outside the configured Community repository", async () => {
    const { provider } = fixture("stable");
    const info = await provider.getLatestVersion();
    info.files[0]!.url = "https://elsewhere.example/update.zip";
    expect(() => provider.resolveFiles(info)).toThrow(/outside the Community/);
  });

  it("rejects an upstream release namespace even if accidentally marked latest in this fork", async () => {
    await expect(fixture("stable", true).provider.getLatestVersion()).rejects.toThrow(
      /Community version namespace/,
    );
  });
});
