import { modelMessageContentToText, type ModelInputMessage } from "@zcode/contracts";
import type { ContextBuildResult, ContextSection } from "./types.js";
import { buildIdentitySection } from "./sections/identity.js";

export type SystemPromptSection = Omit<ContextSection, "source"> & { source: string };

export interface SystemPromptInspection {
  nativeKernel?: import("@zcode/shared").AgentKernelId;
  basePrompt: string;
  defaultPrompt: string;
  sections: Array<SystemPromptSection & { readOnly: true }>;
  busy: boolean;
  lastRequest?: { at: string; systemMessages: string[] };
}

const BASE_SOURCES = new Set(["identity", "main_system_prompt", "custom_system_prompt"]);

/** 使用实际构建结果投影；UI 不维护另一套提示词常量或注入顺序。 */
export function inspectSystemPrompt(
  result: ContextBuildResult,
  options: {
    defaultPrompt?: string;
    busy?: boolean;
    additionalSections?: SystemPromptSection[];
    lastRequest?: SystemPromptInspection["lastRequest"];
  } = {},
): SystemPromptInspection {
  return {
    basePrompt:
      result.sections.find((section) => BASE_SOURCES.has(section.source))?.content.trim() ?? "",
    defaultPrompt: (options.defaultPrompt ?? buildIdentitySection().content).trim(),
    sections: [
      ...result.sections.filter((section) => !BASE_SOURCES.has(section.source)),
      ...(options.additionalSections ?? []),
    ].map((section) => ({ ...section, readOnly: true as const })),
    busy: options.busy === true,
    ...(options.lastRequest
      ? {
          lastRequest: {
            ...options.lastRequest,
            systemMessages: [...options.lastRequest.systemMessages],
          },
        }
      : {}),
  };
}

export function captureSystemPromptRequest(
  messages: readonly ModelInputMessage[],
  at: Date,
): NonNullable<SystemPromptInspection["lastRequest"]> {
  return {
    at: at.toISOString(),
    systemMessages: messages
      .filter((message) => message.role === "system")
      .map((message) => modelMessageContentToText(message.content)),
  };
}
