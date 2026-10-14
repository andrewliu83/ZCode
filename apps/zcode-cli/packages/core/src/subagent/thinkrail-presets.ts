// 修复依据：UI 与 CLI 必须复用同一份预设，避免运行时可用、目录却不可见。
export {
  createThinkrailAgentProfiles,
  isThinkrailAgentProfileName,
  THINKRAIL_AGENT_TYPES,
  type ThinkrailAgentType,
} from "@zcode/shared";
