import type { CustomPublishOptions } from "builder-util-runtime";
import { Provider, type AppUpdater } from "electron-updater";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import {
  COMMUNITY_DISTRIBUTION,
  communityPublishOptions,
} from "../../../../scripts/community-distribution.mjs";
import type { ElectronReleaseChannel } from "@zcode/shared";

type GitHubInfo = Awaited<ReturnType<GitHubProvider["getLatestVersion"]>>;

export interface CommunityGitHubOptions extends CustomPublishOptions {
  resolveReleaseChannel?: () => ElectronReleaseChannel | Promise<ElectronReleaseChannel>;
}

/** 复用 electron-updater 的 GitHub feed/资产解析，增加发行命名空间与通道快照校验。 */
export class CommunityGitHubProvider extends Provider<GitHubInfo> {
  private readonly delegate: GitHubProvider;
  constructor(
    private readonly options: CommunityGitHubOptions,
    private readonly updater: AppUpdater,
    runtime: ProviderRuntimeOptions,
  ) {
    super(runtime);
    this.delegate = new GitHubProvider(communityPublishOptions(), updater, runtime);
  }

  override setRequestHeaders(headers: Record<string, string>): void {
    // 更新只需要公开发行信息；不能向 GitHub 发送 electron-updater 生成的持久灰度标识。
    const publicHeaders = Object.fromEntries(
      Object.entries(headers).filter(([name]) => name.toLowerCase() !== "x-user-staging-id"),
    );
    super.setRequestHeaders(publicHeaders);
    this.delegate.setRequestHeaders(publicHeaders);
  }

  async getLatestVersion(): Promise<GitHubInfo> {
    const channel = (await this.options.resolveReleaseChannel?.()) ?? "stable";
    this.updater.allowPrerelease = channel === "preview";
    this.updater.allowDowngrade = false;
    const info = await this.delegate.getLatestVersion();
    if (info.tag !== `${COMMUNITY_DISTRIBUTION.tagPrefix}${info.version}`)
      throw new Error("Release does not belong to the Community version namespace");
    return Object.assign(info, { zcodeReleaseChannel: channel });
  }

  resolveFiles(info: GitHubInfo) {
    const prefix = `/${COMMUNITY_DISTRIBUTION.github.owner}/${COMMUNITY_DISTRIBUTION.github.repo}/releases/download/${info.tag}/`;
    const withinRelease = (url: URL) =>
      url.origin === "https://github.com" && url.pathname.startsWith(prefix);
    if (info.files.some((file) => !withinRelease(new URL(file.url, `https://github.com${prefix}`))))
      throw new Error("Update asset is outside the Community repository");
    const files = this.delegate.resolveFiles(info);
    if (files.some((file) => !withinRelease(file.url)))
      throw new Error("Update asset is outside the Community repository");
    return files;
  }
}
