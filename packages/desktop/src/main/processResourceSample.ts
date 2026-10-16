import type { ProcessResourceRole, ProcessResourceRuntimeSurface } from "@zcode/shared";

/** 该角色实际运行的机器；缺省时由出口补桌面机的值。 */
export interface ProcessResourceHardware {
  platform: NodeJS.Platform;
  arch: string;
  logicalCpuCount: number;
  totalMemoryGb: number;
}

/**
 * 样本自报的运行机信息，可能只有一部分字段（旧 CLI 不带 `totalMemoryGb`）。
 * 出口按字段逐项覆盖桌面机默认值，不是整体二选一。
 */
export type ProcessResourceHardwareOverride = Partial<ProcessResourceHardware>;

/** 规格分组仅用于本地诊断；环境归属仍由 Host 注入，不使用设备身份。 */
export function processResourceHardwareKey(hardware?: ProcessResourceHardwareOverride): string {
  if (!hardware) return "";
  return [
    hardware.platform ?? "",
    hardware.arch ?? "",
    hardware.logicalCpuCount ?? "",
    hardware.totalMemoryGb ?? "",
  ].join("/");
}

/** 本机设备的一次资源读数，仅供本地诊断。 */
export interface DeviceResourceSample {
  systemCpuPercent: number;
  systemFreeMemoryKb: number;
  appCpuPercent: number;
  appRssKbTotal: number;
  appProcessCount: number;
}

/** 一个角色在某一刻的瞬时事实。 */
export interface ProcessRoleSample {
  role: ProcessResourceRole;
  /** Host 注入的运行环境哈希，仅用于内存分组，不投影到事件属性。 */
  environmentKey?: string;
  /** 角色内全部进程的 CPU 之和（整机归一化百分比）。 */
  cpuPercent: number;
  rssKbTotal: number;
  rssKbMaxProcess: number;
  processCount: number;
  uptimeMinutes: number;
  /** 仅 Node 角色与 renderer_main；缺省表示该次采样没有 heap 读数。 */
  heapUsedKb?: number;
  runtimeSurface?: ProcessResourceRuntimeSurface;
  /** 仅 mcp 角色。 */
  mcpId?: string;
  hardware?: ProcessResourceHardwareOverride;
}
