import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { app, net } from "electron";
import pkg from "electron-updater";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater.js";
import { CancellationError } from "builder-util-runtime";
import {
  COMMUNITY_DISTRIBUTION,
  communityPublishOptions,
} from "../../../../scripts/community-distribution.mjs";
import { prepareCommunityMacUpdate, type PreparedMacUpdate } from "./communityMacInstaller.js";

const { AppUpdater: AppUpdaterBase } = pkg;

/** 复用公开 AppUpdater 传输契约；ad hoc app 不交给要求稳定 Developer ID 的 Squirrel。 */
export class CommunityMacUpdater extends AppUpdaterBase {
  private prepared: PreparedMacUpdate | undefined;
  private installing = false;

  constructor() {
    super(communityPublishOptions());
  }

  protected async doDownloadUpdate(options: DownloadUpdateOptions): Promise<string[]> {
    const { provider, info } = options.updateInfoAndProvider;
    const file = provider
      .resolveFiles(info)
      .find((entry) => entry.url.pathname.toLowerCase().endsWith(".zip"));
    if (!file?.info.sha512) throw new Error("Community update requires a ZIP with SHA-512");
    return this.executeDownload({
      fileExtension: "zip",
      fileInfo: file,
      downloadUpdateOptions: options,
      task: async (destination, downloadOptions) => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const token = options.cancellationToken;
        if (token.cancelled) throw new CancellationError();
        token.on("cancel", cancel);
        try {
          const response = await net.fetch(file.url.href, {
            headers: downloadOptions.headers as Record<string, string>,
            signal: controller.signal,
          });
          if (!response.ok || !response.body)
            throw new Error(`Update download failed: HTTP ${response.status}`);
          const digest = createHash("sha512");
          const total = file.info.size ?? Number(response.headers.get("content-length") ?? 0);
          const start = Date.now();
          let transferred = 0;
          let lastReported = 0;
          const observe = new Transform({
            transform: (chunk, _encoding, callback) => {
              digest.update(chunk);
              transferred += chunk.length;
              if (transferred > 4 * 1024 ** 3)
                return callback(new Error("Update archive is too large"));
              if (Date.now() - lastReported > 200 || transferred === total) {
                lastReported = Date.now();
                this.emit("download-progress", {
                  total,
                  transferred,
                  delta: chunk.length,
                  percent: total > 0 ? (100 * transferred) / total : 0,
                  bytesPerSecond: transferred / Math.max((Date.now() - start) / 1000, 1),
                });
              }
              callback(null, chunk);
            },
          });
          await pipeline(
            Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
            observe,
            createWriteStream(destination),
            { signal: controller.signal },
          );
          const expected = Buffer.from(file.info.sha512, "base64");
          const actual = digest.digest();
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
            throw new Error("Community update SHA-512 mismatch");
        } catch (error) {
          if (token.cancelled) throw new CancellationError();
          throw error;
        } finally {
          token.removeListener("cancel", cancel);
        }
      },
      done: async (event) => {
        if (this.prepared) await rm(this.prepared.staging, { recursive: true, force: true });
        this.prepared = undefined;
        const prepared = await prepareCommunityMacUpdate({
          archive: event.downloadedFile,
          target: dirname(dirname(dirname(app.getAppPath()))),
          appId: COMMUNITY_DISTRIBUTION.appId,
          appName: COMMUNITY_DISTRIBUTION.name,
          arch: process.arch,
          version: info.version,
        });
        if (options.cancellationToken.cancelled) {
          await rm(prepared.staging, { recursive: true, force: true });
          throw new CancellationError();
        }
        this.prepared = prepared;
        this.dispatchUpdateDownloaded(event);
      },
    });
  }

  async quitAndInstall(): Promise<void> {
    if (this.installing) return;
    const prepared = this.prepared;
    if (!prepared) throw new Error("Community update is not staged; download it again");
    this.installing = true;
    const log = join(app.getPath("logs"), "community-update-install.log");
    // 先建立日志目录，只有 helper 真正启动后才退出；所有路径作为 argv，不拼接命令。
    try {
      await mkdir(dirname(log), { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "/bin/sh",
          [
            prepared.helper,
            String(process.pid),
            prepared.target,
            prepared.next,
            prepared.backup,
            prepared.staging,
            log,
            "1",
          ],
          { detached: true, stdio: "ignore" },
        );
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
      this.app.quit();
    } catch (error) {
      this.installing = false;
      throw error;
    }
  }
}
