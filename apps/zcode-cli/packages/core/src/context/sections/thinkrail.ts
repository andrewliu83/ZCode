// ============================================================
// ThinkRail 常驻段（spec ground truth + workflow 路由）
// ============================================================
// 两条规则合成**一条** dynamic section（docs/thinkrail/design.md D3）。它们是**指针而不是复述**：
// spec 的判据与工具用法住在 `spec-graph` 技能里，workflow 的路由表住在 `choosing-a-workflow` 技能里。
//
// 两条规则独立判断能力：无 spec 的首次导入仍必须收到工作流路由。
// 两条规则都需要 Skill 工具；spec 规则还需要真实 spec 和读侧工具。
//
// 与 builtInTools 的算子（handlers/index.ts）**各自独立**：技能减法是计划中的第三处（P4）。
// 三处共同的判据只有一条 —— `runtimeFeatures.thinkrail === true`。

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

/** spec 读侧三件：本段主体内容所需的锚点（不用「全部都要」）。 */
const THINKRAIL_SECTION_ANCHORS = ["spec_grep", "spec_get", "spec_graph"] as const;

/** anchor 常量与 @zcode/contracts 的工具名同字面；漂移由 core 的 thinkrail-spec-tools.test.ts 守住。 */

export interface ThinkrailSectionOptions {
  /** 开关和 scope 能力分别决定两条规则是否注入。 */
  readonly enabled: boolean;
  readonly toolNames: readonly string[];
  /**
   * 工作区的 spec 事实。**必填**：调用点必须真的探过，不能靠「工具开着就默认有」——
   * 那会让空项目也拿到一条指向空目录的规则。
   */
  readonly hasSpec: boolean;
  readonly specRule: string;
  readonly workflowRule: string;
}

export function buildThinkrailSection(options: ThinkrailSectionOptions): ContextSection | null {
  if (!options.enabled) return null;
  const tools = new Set(options.toolNames);
  // 原因：把 workflow 与 hasSpec 绑定会让尚未建立 spec 的项目失去初始化路由。
  // spec 规则也要求先加载 spec-graph 技能，缺少 Skill 的受限 scope 不能收到这条指令。
  const rules = [
    ...(tools.has("Skill") &&
    options.hasSpec &&
    THINKRAIL_SECTION_ANCHORS.every((name) => tools.has(name))
      ? [options.specRule]
      : []),
    ...(tools.has("Skill") ? [options.workflowRule] : []),
  ];
  if (rules.length === 0) return null;
  const content = rules.join("\n\n");
  return {
    name: "ThinkRail",
    source: "thinkrail",
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
