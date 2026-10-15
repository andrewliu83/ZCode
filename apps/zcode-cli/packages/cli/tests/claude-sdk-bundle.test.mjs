import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import * as cliBuild from "../scripts/build.mjs";

const require = createRequire(import.meta.url);
const adapterRequire = createRequire(new URL("../../adapters/package.json", import.meta.url));

test("发行 CJS 在隔离目录能加载真实 Claude SDK，包括其 createRequire/import.meta 初始化", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-sdk-cjs-"));
  const sdkCore = adapterRequire.resolve("@anthropic-ai/claude-agent-sdk/core");
  const output = join(root, "sdk-bundle.cjs");
  try {
    await build({
      ...(cliBuild.resolveCjsModuleMetadata?.() ?? {}),
      stdin: {
        contents:
          'export { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk/core";',
        resolveDir: dirname(sdkCore),
        sourcefile: "sdk-cjs-fixture.mjs",
      },
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: output,
      logLevel: "silent",
    });
    const sdk = require(output);
    assert.equal(typeof sdk.query, "function");
    assert.equal(typeof sdk.createSdkMcpServer, "function");
    const server = sdk.createSdkMcpServer({ name: "bundle-fixture", version: "1.0.0", tools: [] });
    assert.equal(server.name, "bundle-fixture");
    assert.equal(server.type, "sdk");
  } finally {
    delete require.cache[output];
    await rm(root, { recursive: true, force: true });
  }
});
