import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { resolveSpawnRuntimeOptions, quoteArgsForWindowsShell } from "./spawn-command.mjs";

/** 不把 argv 写入异常，避免 Apple 密码从子进程错误泄漏。 */
export function runReleaseCommand(
  command,
  args,
  { cwd, env = process.env, capture = false, timeout } = {},
) {
  return new Promise((resolve, reject) => {
    const runtime = resolveSpawnRuntimeOptions(command);
    const child = spawn(command, runtime.shell ? quoteArgsForWindowsShell(args) : args, {
      ...runtime,
      cwd,
      env,
      timeout,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture)
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
    child.once("error", () => reject(new Error(`${command} could not start`)));
    child.once("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} failed (exit ${code})`)),
    );
  });
}

const REQUIRED_APPLE_FIELDS = [
  "MACOS_CERTIFICATE_P12_BASE64",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

export function resolveAppleSigningMode(env = process.env) {
  const configured = REQUIRED_APPLE_FIELDS.filter((key) => env[key]?.trim());
  if (configured.length === 0) return "ad-hoc";
  if (configured.length !== REQUIRED_APPLE_FIELDS.length)
    throw new Error(
      `Incomplete Apple signing configuration; required: ${REQUIRED_APPLE_FIELDS.join(", ")}`,
    );
  if (!env.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application:"))
    throw new Error("APPLE_SIGNING_IDENTITY must be a Developer ID Application identity");
  return "native";
}

export async function createAppleSigningContext(env = process.env) {
  const mode = resolveAppleSigningMode(env);
  if (mode === "ad-hoc") return { mode, identity: "-", close: async () => {} };
  const temp = await mkdtemp(join(tmpdir(), "zcode-community-signing-"));
  const keychain = join(temp, "release.keychain-db");
  const certificate = join(temp, "certificate.p12");
  const password = randomBytes(32).toString("hex");
  const previous = await runReleaseCommand("security", ["list-keychains", "-d", "user"], {
    capture: true,
  });
  const originalKeychains = [...previous.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const close = async () => {
    await runReleaseCommand("security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      ...originalKeychains,
    ]);
    await runReleaseCommand("security", ["delete-keychain", keychain]).catch(() => {});
    await rm(temp, { recursive: true, force: true });
  };
  try {
    await writeFile(certificate, Buffer.from(env.MACOS_CERTIFICATE_P12_BASE64, "base64"), {
      mode: 0o600,
    });
    await runReleaseCommand("security", ["create-keychain", "-p", password, keychain]);
    await runReleaseCommand("security", ["set-keychain-settings", "-lut", "21600", keychain]);
    await runReleaseCommand("security", ["unlock-keychain", "-p", password, keychain]);
    await runReleaseCommand("security", [
      "import",
      certificate,
      "-k",
      keychain,
      "-P",
      env.MACOS_CERTIFICATE_PASSWORD ?? "",
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    await runReleaseCommand(
      "security",
      [
        "set-key-partition-list",
        "-S",
        "apple-tool:,apple:,codesign:",
        "-s",
        "-k",
        password,
        keychain,
      ],
      { capture: true },
    );
    await runReleaseCommand("security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      keychain,
      ...originalKeychains,
    ]);
    return { mode, keychain, identity: env.APPLE_SIGNING_IDENTITY, close };
  } catch (error) {
    await close();
    throw error;
  }
}
