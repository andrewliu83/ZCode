import type { NativeAgentRequest } from "@zcode/contracts";
import type { AgentProfile } from "@zcode/shared";

/** SDK 原生角色不重复登记；插件裸名仅是调用别名，不是第二个子代理实体。 */
export function nativeAgentProfiles(
  profiles: readonly Readonly<AgentProfile>[],
  builtInAgents: readonly string[] = [],
): NativeAgentRequest["agents"] {
  const canonicalPaths = new Set(
    profiles
      .filter((profile) => profile.name.includes(":") && profile.path)
      .map((profile) => profile.path),
  );
  return Object.fromEntries(
    profiles
      .filter((profile) => {
        if (profile.source === "built-in" && builtInAgents.includes(profile.name)) return false;
        return !profile.path || profile.name.includes(":") || !canonicalPaths.has(profile.path);
      })
      .map((profile) => [
        profile.name,
        {
          description: profile.description,
          prompt: profile.systemPrompt,
          tools: profile.tools ? [...profile.tools] : undefined,
          disallowedTools: profile.disallowedTools ? [...profile.disallowedTools] : undefined,
          modelSelection: profile.modelSelection,
          maxTurns: profile.maxTurns,
          skills: profile.skills ? [...profile.skills] : undefined,
          memory: profile.memory,
          permissionMode: profile.permissionMode,
          background: profile.background,
        },
      ]),
  );
}
