import { createConfig } from "@zcode/adapters/config";
import { createNodeContextSourceAdapter } from "@zcode/adapters/context";
import { createContextBuilder, inspectSystemPrompt, registerBuiltInTools } from "@zcode/core";
import { SPEC_RULE, WORKFLOW_RULE, workspaceHasSpec } from "@zcode/thinkrail";
import {
  zcodeProtocolErrorCodes,
  zcodeSystemPromptReadParamsSchema,
  zcodeSystemPromptReadResultSchema,
  zcodeWorkspaceUpdateSystemPromptPolicyParamsSchema,
} from "@zcode/shared";
import { listZCodeSkills } from "../skills.js";
import { filterBundledSkillCatalog } from "../app/bundled-skill-policy.js";
import {
  parseParams,
  ProtocolRequestError,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

export function updateSystemPromptPolicy(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeWorkspaceUpdateSystemPromptPolicyParamsSchema, rawParams);
  context.appRuntimePreferences.mainSystemPrompt = params.mainSystemPrompt.trim() || undefined;
  return { ...params, mainSystemPrompt: context.appRuntimePreferences.mainSystemPrompt ?? "" };
}

export async function readSystemPrompt(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeSystemPromptReadParamsSchema, rawParams);
  const availableSessions = [...context.sessions.entries()]
    .filter(
      ([, record]) =>
        record.workspace.workspaceKey === params.workspace.workspaceKey && !record.parentSessionId,
    )
    .map(([sessionId]) => ({ sessionId }));
  if (params.sessionId) {
    const record = context.sessions.get(params.sessionId);
    if (!record || record.workspace.workspaceKey !== params.workspace.workspaceKey) {
      throw new ProtocolRequestError(
        zcodeProtocolErrorCodes.sessionUnavailable,
        "Session is not resident in this workspace",
      );
    }
    return zcodeSystemPromptReadResultSchema.parse({
      ...(await record.app.getSystemPromptInspection()),
      authority: "session",
      availableSessions,
    });
  }

  const cwd = params.workspace.workspacePath;
  const config = createConfig({ workingDirectory: cwd, env: context.deps.env });
  const thinkrailEnabled = context.appRuntimePreferences.thinkrailEnabled;
  const snapshot = await createNodeContextSourceAdapter({
    env: context.deps.env,
  }).resolveContextSources({
    workingDirectory: cwd,
    userInstructions: { workingDirectory: cwd },
  });
  const skills = filterBundledSkillCatalog(
    await listZCodeSkills({
      env: context.deps.env,
      workingDirectory: cwd,
      logger: context.logger,
      includeVisualize: true,
    }),
    {
      thinkrailEnabled,
      dynamicWorkflowEnabled: context.appRuntimePreferences.dynamicWorkflowEnabled,
    },
  );
  const guidanceToolNames: string[] = [];
  registerBuiltInTools(
    {
      register: (entry) => {
        guidanceToolNames.push(entry.metadata.name);
      },
    },
    {
      includeAgent: config.config.features.subagent,
      includeSkill: config.config.features.skill,
      includeThinkrail: thinkrailEnabled,
      includeDynamicWorkflow: context.appRuntimePreferences.dynamicWorkflowEnabled,
    },
  );
  const result = createContextBuilder({
    ...snapshot,
    workingDirectory: cwd,
    envInfo: snapshot.envInfo,
    mainSystemPrompt: context.appRuntimePreferences.mainSystemPrompt,
    presentationSurface: params.presentationSurface,
    skills,
    guidanceToolNames,
    thinkrail: {
      enabled: thinkrailEnabled,
      hasSpec: thinkrailEnabled && workspaceHasSpec(cwd),
      specRule: SPEC_RULE,
      workflowRule: WORKFLOW_RULE,
    },
  }).build();
  return zcodeSystemPromptReadResultSchema.parse({
    ...inspectSystemPrompt(result),
    authority: "workspace",
    availableSessions,
  });
}
