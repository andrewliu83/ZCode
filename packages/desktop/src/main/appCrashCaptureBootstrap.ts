import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 数据目录先完成初始化；crashpad 仅在本地归档，永远不允许远端上传。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger);
