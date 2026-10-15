import type { SkillLoadOutcome, SkillPort, TraceContext } from "@zcode/contracts";
import { thinkrailEntrySkillNames } from "./sections/thinkrail.js";

const MAX_ENTRY_SKILL_BYTES = 100_000;

/** SDK 可能裁掉路由描述并跳过 Skill；从同一可信快照真实加载入口，避免初始化分支不可见。 */
export async function preloadThinkrailSkills(options: {
  enabled: boolean;
  toolNames: readonly string[];
  outcome: SkillLoadOutcome;
  port: SkillPort;
  workingDirectory: string;
  trace?: TraceContext;
  signal?: AbortSignal;
}): Promise<SkillLoadOutcome> {
  const preloadedSkills = [];
  for (const name of thinkrailEntrySkillNames(options.enabled, options.toolNames)) {
    options.signal?.throwIfAborted();
    const metadata = options.outcome.skills.find(
      (skill) =>
        skill.name === name &&
        skill.source === "bundled" &&
        skill.safeToAutoLoad &&
        skill.policy?.allowImplicitInvocation !== false,
    );
    if (!metadata) throw new Error(`Required ThinkRail entry skill is unavailable: ${name}`);
    const loaded = await options.port.loadSkill(
      {
        name: metadata.qualifiedName ?? metadata.name,
        workingDirectory: options.workingDirectory,
        roots: [
          { path: metadata.rootPath, source: metadata.source, scope: metadata.scope, priority: 0 },
        ],
        maxBytes: MAX_ENTRY_SKILL_BYTES,
        trace: options.trace,
      },
      { signal: options.signal },
    );
    // 外部同名技能、迟到目录变化或截断不能悄悄替代产品必需的可信入口。
    if (
      loaded.metadata.path !== metadata.path ||
      loaded.metadata.name !== metadata.name ||
      loaded.metadata.source !== "bundled" ||
      !loaded.metadata.safeToAutoLoad ||
      loaded.metadata.policy?.allowImplicitInvocation === false ||
      loaded.truncated ||
      !loaded.content.trim()
    )
      throw new Error(`Required ThinkRail entry skill could not be loaded completely: ${name}`);
    preloadedSkills.push(loaded);
  }
  return { ...options.outcome, preloadedSkills };
}
