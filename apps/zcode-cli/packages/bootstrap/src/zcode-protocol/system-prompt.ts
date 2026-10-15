import { createConfig } from "@zcode/adapters/config";
import { formatClaudeSystemPromptExtension } from "@zcode/adapters/agent-kernel";
import { createNodeContextSourceAdapter } from "@zcode/adapters/context";
import { createContextBuilder, inspectSystemPrompt, registerBuiltInTools } from "@zcode/core";
import { SPEC_RULE, WORKFLOW_RULE } from "@zcode/thinkrail";
import {
  zcodeProtocolErrorCodes,
  resolveKernelSystemPrompt,
  BUILT_IN_AGENT_KERNELS,
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
  context.appRuntimePreferences.kernelSystemPrompts = params.kernelSystemPrompts;
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
    .map(([sessionId, record]) => ({
      sessionId,
      agentKernel: record.app.runtime?.getAgentKernel?.() ?? "zcode",
    }));
  const availableAgentKernels = [
    ...new Map(
      [
        ...BUILT_IN_AGENT_KERNELS,
        ...[...context.sessions.values()].flatMap(
          (record) => record.app.runtime?.getAvailableAgentKernels?.() ?? [],
        ),
      ].map((descriptor) => [descriptor.id, descriptor]),
    ).values(),
  ];
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
      availableAgentKernels,
      availableSessions,
    });
  }

  const kernel = params.agentKernel ?? "zcode";
  const known = availableAgentKernels.some((descriptor) => descriptor.id === kernel);
  if (!known) throw new ProtocolRequestError(-32602, `Unsupported agent kernel: ${kernel}`);
  const basePrompt = resolveKernelSystemPrompt(context.appRuntimePreferences, kernel);
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
    mainSystemPrompt: basePrompt,
    presentationSurface: params.presentationSurface,
    skills,
    guidanceToolNames,
    thinkrail: {
      enabled: thinkrailEnabled,
      specRule: SPEC_RULE,
      workflowRule: WORKFLOW_RULE,
    },
  }).build();
  const inspection = inspectSystemPrompt(result);
  // 原因：SDK 的 preset/动态上下文由 SDK 管理；工作区预览不能冒充完整 ZCode 正文。
  if (kernel !== "zcode") {
    const sections = inspection.sections
      .filter((section) => section.source === "thinkrail")
      .map((section) => {
        const content =
          kernel === "claude"
            ? formatClaudeSystemPromptExtension(section.content)
            : section.content;
        return {
          ...section,
          content,
          chars: content.length,
          tokens: Math.ceil(content.length / 4),
          preview: content.slice(0, 100),
        };
      });
    return zcodeSystemPromptReadResultSchema.parse({
      nativeKernel: kernel,
      basePrompt: basePrompt ?? "",
      defaultPrompt: "",
      sections,
      busy: false,
      authority: "workspace",
      availableAgentKernels,
      availableSessions,
    });
  }
  return zcodeSystemPromptReadResultSchema.parse({
    ...inspection,
    authority: "workspace",
    availableAgentKernels,
    availableSessions,
  });
}
