// ThinkRail 的两条常驻规则原文 —— 移植自 dsh-plugin-thinkrail 的 lib/index.js（MIT）。
//
// 两条都是**指针而不是复述**：spec 的判据与工具用法只住在 `spec-graph` 技能里，workflow 的路由表
// 只住在 `choosing-a-workflow` 技能里。规则短且字节稳定，才不会搅动 provider 的 prompt 缓存；
// 详细内容按需经 Skill 工具拉取（spec-graph 技能随 P4 的技能族一起落盘）。
//
// 工具名是**内核裸名**（`spec_grep` 等）：走内核而非 MCP 的收益之一就是这两段正文不需要改写，
// 也不存在「技能里写全名、工具面漏改一处就静默失效」的那一类断点（docs/thinkrail/design.md D4）。

import { SPEC_GET_TOOL_NAME, SPEC_GRAPH_TOOL_NAME, SPEC_GREP_TOOL_NAME } from "./tool-names.js";

/**
 * spec ground truth。常驻注入的前提是「这个工作区真的有 spec」——空项目里它只会指向空目录，
 * 判定在 core 的 section 侧（见 core/src/context/sections/thinkrail.ts）。
 */
export const SPEC_RULE = [
  "Specs are this project's ground truth.",
  `- Before you explore the codebase, plan, start a task, or add/change a feature, FIRST read the spec-graph skill, then use ${SPEC_GREP_TOOL_NAME} / ${SPEC_GET_TOOL_NAME} / ${SPEC_GRAPH_TOOL_NAME} to find and read the relevant specs — specs before code.`,
  "- Treat their decisions and contracts as authoritative; reconcile every change against them and surface any contradiction instead of diverging.",
  "- When a change alters a boundary, contract, or decision, update the spec as part of that change.",
].join("\n");

/**
 * workflow 路由。与 SPEC_RULE 一样是**指针**：路由表只住在 `choosing-a-workflow` 技能里，
 * 每个工作流的步骤只住在它自己的技能里。
 */
export const WORKFLOW_RULE = [
  "At the start of any new piece of work — a request, feature, change, fix, or fresh project idea —",
  "read the choosing-a-workflow skill FIRST and follow it: it routes the work to the workflow skill",
  "that governs it, or tells you none applies.",
].join("\n");
