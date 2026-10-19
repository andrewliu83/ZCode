import { open, stat } from "node:fs/promises";

export const CUA_DRIVER_TARGETS = Object.freeze({
  "darwin-arm64": { platform: "darwin", arch: "arm64" },
  "win32-x64": { platform: "win32", arch: "x64" },
  "linux-x64": { platform: "linux", arch: "x64" },
});

export function isSupportedCuaDriverTarget(target) {
  const expected = CUA_DRIVER_TARGETS[`${target.os}-${target.arch}`];
  return Boolean(expected && expected.platform === target.os && expected.arch === target.arch);
}

function readMachOCpuType(buffer, offset = 0) {
  if (buffer.length < offset + 8) return undefined;
  const magic = buffer.subarray(offset, offset + 4).toString("hex");
  const little = magic === "cffaedfe" || magic === "cefaedfe";
  if (!little && magic !== "feedfacf" && magic !== "feedface") return undefined;
  return buffer.readUInt32LE(offset + 4);
}

function readFatMachOCpuTypes(buffer) {
  // 0xcafebabe 是 universal/fat 容器：>u32 count 后跟 count 个 (cputype, cpusubtype, offset, size, align)。
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0xcafebabe) return undefined;
  const count = buffer.readUInt32BE(4);
  if (count < 1 || count > 16 || buffer.length < 8 + count * 20) return undefined;
  return Array.from({ length: count }, (_, index) => buffer.readUInt32BE(8 + index * 20));
}

const CPU_TYPE = { arm64: 0x0100000c, x64: 0x01000007 };

export async function assertBinary(path, arch, executable = false) {
  const info = await stat(path);
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(64), 0, 64, 0);
    // 可执行位只在 POSIX 目标上是有效证据；Windows 归档不携带该位。
    if (
      !info.isFile() ||
      (executable && process.platform !== "win32" && !path.endsWith(".exe") && !(info.mode & 0o111))
    ) {
      throw new Error(`Invalid Cua Driver binary: ${path}`);
    }
    // 按文件魔数判断容器，跨目标校验时不依赖宿主 OS。
    if (buffer.subarray(0, 2).toString("ascii") === "MZ") {
      // PE：MZ + PE 签名；架构由 COFF header 的 Machine 字段确认。
      if (bytesRead < 64) throw new Error(`Invalid Cua Driver PE: ${path}`);
      const peOffset = buffer.readUInt32LE(0x3c);
      const peHeader = Buffer.alloc(6);
      await handle.read(peHeader, 0, 6, peOffset);
      if (peHeader.subarray(0, 4).toString("binary") !== "PE\0\0") {
        throw new Error(`Invalid Cua Driver PE header: ${path}`);
      }
      const want = arch === "arm64" ? 0xaa64 : 0x8664;
      if (peHeader.readUInt16LE(4) !== want) {
        throw new Error(`Cua Driver ${arch} PE mismatch: ${path}`);
      }
      return;
    }
    if (buffer.subarray(0, 4).toString("hex") === "7f454c46") {
      // ELF：e_machine (0x3e = x86_64, 0xb7 = aarch64)。
      const want = arch === "arm64" ? 0xb7 : 0x3e;
      if (bytesRead < 20 || buffer.readUInt16LE(18) !== want) {
        throw new Error(`Cua Driver ${arch} ELF mismatch: ${path}`);
      }
      return;
    }
    const fat = readFatMachOCpuTypes(buffer);
    if (fat) {
      if (!fat.includes(CPU_TYPE[arch])) {
        throw new Error(`Cua Driver ${arch} Mach-O mismatch: ${path}`);
      }
      return;
    }
    const cpu = readMachOCpuType(buffer);
    if (cpu !== CPU_TYPE[arch]) {
      throw new Error(`Cua Driver ${arch} Mach-O mismatch: ${path}`);
    }
  } finally {
    await handle.close();
  }
}

export const NATIVE_PACKAGE_BY_KEY = {
  "darwin-arm64": {
    name: "@trycua/cua-driver-darwin-arm64",
    files: ["libcua_driver_sdk.dylib", "cua_driver_node_runtime.node"],
  },
  "win32-x64": {
    name: "@trycua/cua-driver-win32-x64-msvc",
    files: ["cua_driver_sdk.dll", "cua_driver_node_runtime.node"],
  },
  "linux-x64": {
    name: "@trycua/cua-driver-linux-x64-gnu",
    files: ["libcua_driver_sdk.so", "cua_driver_node_runtime.node"],
  },
};
