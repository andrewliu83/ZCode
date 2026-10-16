import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CancellationError, CancellationToken } from "builder-util-runtime";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater.js";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  destination: "",
  fetch: vi.fn(),
  prepare: vi.fn(),
  downloaded: vi.fn(),
  quit: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/Applications/ZCode Community.app/Contents/Resources/app.asar",
    getPath: () => "/tmp/community-updater-test",
    quit: fixture.quit,
  },
  net: { fetch: fixture.fetch },
}));
vi.mock("../src/main/communityMacInstaller.js", () => ({
  prepareCommunityMacUpdate: fixture.prepare,
}));
vi.mock("electron-updater", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: {
      AppUpdater: class extends EventEmitter {
        protected app = { quit: fixture.quit };
        async executeDownload(options: {
          task: (path: string, options: { headers: Record<string, string> }) => Promise<void>;
          done: (event: { downloadedFile: string }) => Promise<void>;
        }) {
          await options.task(fixture.destination, { headers: {} });
          await options.done({ downloadedFile: fixture.destination });
          return [fixture.destination];
        }
        dispatchUpdateDownloaded = fixture.downloaded;
      },
    },
  };
});

import { CommunityMacUpdater } from "../src/main/communityMacUpdater.js";
class Probe extends CommunityMacUpdater {
  download(options: DownloadUpdateOptions) {
    return this.doDownloadUpdate(options);
  }
}
const bytes = new TextEncoder().encode("fixture signed archive bytes");
const hash = createHash("sha512").update(bytes).digest("base64");
function options(token = new CancellationToken(), digest = hash) {
  return {
    cancellationToken: token,
    updateInfoAndProvider: {
      info: { version: "0.1.1" },
      provider: {
        resolveFiles: () => [
          {
            url: new URL(
              "https://github.com/andrewliu83/ZCode/releases/download/community-v0.1.1/app.zip",
            ),
            info: { sha512: digest, size: bytes.length },
          },
        ],
      },
    },
  } as unknown as DownloadUpdateOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.fetch.mockImplementation(async () => new Response(bytes));
  fixture.prepare.mockResolvedValue({ staging: "/tmp/unused-community-staging" });
});

it.each(["valid", "corrupt", "invalid-app"])(
  "verifies download before ready, preserves running app (%s)",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "community-download-"));
    const token = new CancellationToken();
    fixture.destination = join(root, "update.zip");
    if (kind === "invalid-app")
      fixture.prepare.mockRejectedValue(new Error("Update application identity mismatch"));
    try {
      const result = new Probe().download(options(token, kind === "corrupt" ? "invalid" : hash));
      if (kind === "valid") {
        await expect(result).resolves.toEqual([fixture.destination]);
        expect(await readFile(fixture.destination)).toEqual(Buffer.from(bytes));
        expect(fixture.downloaded).toHaveBeenCalledOnce();
      } else {
        await expect(result).rejects.toThrow(kind === "corrupt" ? /SHA-512/ : /identity/);
        expect(fixture.downloaded).not.toHaveBeenCalled();
        if (kind === "corrupt") expect(fixture.prepare).not.toHaveBeenCalled();
      }
      expect(fixture.quit).not.toHaveBeenCalled();
      expect(token.listenerCount("cancel")).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("cancellation aborts the transport and does not stage or quit", async () => {
  const token = new CancellationToken();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  fixture.fetch.mockImplementation(
    (_url, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("transport aborted")), {
          once: true,
        });
        started();
      }),
  );
  const result = new Probe().download(options(token));
  await ready;
  token.cancel();
  await expect(result).rejects.toBeInstanceOf(CancellationError);
  expect(fixture.prepare).not.toHaveBeenCalled();
  expect(fixture.downloaded).not.toHaveBeenCalled();
  expect(fixture.quit).not.toHaveBeenCalled();
  expect(token.listenerCount("cancel")).toBe(0);
});
