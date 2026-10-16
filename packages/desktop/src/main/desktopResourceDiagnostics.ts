import {
  createMemorySampleWriteGate,
  formatMemorySampleLine,
  memoryUsageToSampleFields,
  type MemorySample,
} from "@zcode/shared";
import { mainMemoryDiagnosticsRegistry } from "./mainMemoryDiagnostics.js";
import { PROCESS_RESOURCE_SAMPLE_SOURCES } from "./processResourceSampleSourceRegistry.js";
import {
  resetProcessResourceSampleSources,
  runProcessResourceSampleSources,
} from "./processResourceSampleSources.js";
import type { ProcessRoleSample } from "./processResourceSample.js";
import { listRegisteredHostAgentProcessIds } from "./resourceManagerWindow.js";

/** 本地内存诊断沿用已有样本来源；不保存设备身份、不创建网络出口，也不起外部探针。 */
export const RESOURCE_SAMPLE_INTERVAL_MS = 10_000;
export const MEMORY_LOG_SAMPLE_EVERY_N_TICKS = 6;
interface ResourceLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}
let sampleTimer: ReturnType<typeof setInterval> | null = null;

export function registerDesktopResourceDiagnostics(logger: ResourceLogger): void {
  stopDesktopResourceDiagnostics();
  resetProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES);
  const writeGate = createMemorySampleWriteGate();
  let tick = 0;
  let auditedAgentProbe = false;
  sampleTimer = setInterval(() => {
    try {
      const samples: ProcessRoleSample[] = [];
      runProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
        now: Date.now(),
        addRoleSample: (sample) => samples.push(sample),
        addRoleHeapSample: () => {},
        addAppProcessTotals: () => {},
        onError: (source, error) =>
          logger.warn(`[resource] sample source ${source} failed:`, error),
      });
      if (
        !auditedAgentProbe &&
        process.platform === "win32" &&
        process.env.ZCODE_E2E_RUNTIME_LOG_DIR?.trim()
      ) {
        const count = listRegisteredHostAgentProcessIds().length;
        if (count > 0) {
          auditedAgentProbe = true;
          logger.info(
            `[resource] agent_metric_probe action=skipped reason=main_process_external_probe_disabled agent_count=${count}`,
          );
        }
      }
      tick += 1;
      if (tick % MEMORY_LOG_SAMPLE_EVERY_N_TICKS !== 0) return;
      const counters = mainMemoryDiagnosticsRegistry.collect();
      for (const sample of samples) counters[`ws.${sample.role}`] = sample.rssKbTotal;
      const sample: MemorySample = {
        role: "main",
        ...memoryUsageToSampleFields(process.memoryUsage()),
        counters,
      };
      const reason = writeGate.evaluate(sample, Date.now());
      if (reason) logger.info(formatMemorySampleLine(sample, reason));
    } catch (error) {
      logger.warn("[resource] local memory sample failed:", error);
    }
  }, RESOURCE_SAMPLE_INTERVAL_MS);
  sampleTimer.unref?.();
}

export function stopDesktopResourceDiagnostics(): void {
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
}
