// Composer Skill 只读 catalog。
// 与 Skills Settings 管理接口分离：这里的 sessionId 决定 authority，不提供启停/删除能力。
import {
  zcodeSkillsReferenceCatalogParamsSchema,
  type ZCodeSkillReferenceCatalogEntry,
  type ZCodeSkillsReferenceCatalogResult,
} from "@zcode/shared";
import type { SkillLoadOutcome, SkillMetadata } from "@zcode/contracts";
import { listZCodeSkills } from "../skills.js";
import { filterBundledSkillCatalog } from "../app/bundled-skill-policy.js";
import {
  parseParams,
  requireSession,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

export async function getSkillReferenceCatalog(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
  includeBuiltIns = false,
): Promise<ZCodeSkillsReferenceCatalogResult> {
  const params = parseParams(zcodeSkillsReferenceCatalogParamsSchema, rawParams);
  if (params.sessionId) {
    const record = requireSession(context, params.sessionId);
    const outcome = await record.app.getSkillCatalog();
    return toResult("session", outcome, includeBuiltIns);
  }

  // 旧 UI cache 只在 workspace 首次挂载时扫描，用户从文件系统手动新增
  // Skill 后，新建对话仍停在旧快照。草稿请求在 Agent 侧复用 CLI 正式发现配置，
  // 每次新打开引用面板都读取当前 workspace catalog。
  const outcome = await listZCodeSkills({
    env: context.deps.env,
    includeVisualize: true,
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  // 修复依据：草稿不能绕过 Host 总开关，重新扫描后复活已关闭的随包技能。
  const gated = filterBundledSkillCatalog(outcome, {
    thinkrailEnabled: context.appRuntimePreferences?.thinkrailEnabled === true,
    dynamicWorkflowEnabled: context.appRuntimePreferences?.dynamicWorkflowEnabled === true,
  });
  return toResult("workspace", gated, includeBuiltIns);
}

function toResult(
  authority: ZCodeSkillsReferenceCatalogResult["authority"],
  outcome: SkillLoadOutcome,
  includeBuiltIns: boolean,
): ZCodeSkillsReferenceCatalogResult {
  return {
    authority,
    // 旧入口继续只返回旧 scope；内置项通过新入口提供，保持远端旧客户端兼容。
    skills: outcome.skills
      .filter((skill) => includeBuiltIns || skill.source !== "bundled")
      .map(toReferenceCatalogEntry),
  };
}

function toReferenceCatalogEntry(skill: SkillMetadata): ZCodeSkillReferenceCatalogEntry {
  const scope =
    skill.source === "bundled"
      ? "built-in"
      : skill.source === "plugin"
        ? "plugin"
        : skill.scope === "project"
          ? "workspace"
          : "user";
  return {
    // `glm:` 是现有 UI provider 过滤契约；路径使同名不同来源仍有稳定行身份。
    id: `glm:${scope}:${skill.path}`,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope,
    enabled: true,
    ...(skill.source === "bundled" ? { readOnly: true as const } : {}),
    ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
  };
}
