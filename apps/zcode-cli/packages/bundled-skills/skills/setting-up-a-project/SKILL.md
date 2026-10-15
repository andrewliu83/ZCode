---
name: setting-up-a-project
description: "Use when real source code exists but no spec graph, including read-only project familiarization; also whenever asked to set up, onboard, initialize, or spec a project. Dispatch existing code to importing-a-codebase, empty workspaces to starting-a-new-project. Not for feature work in an already-specced project."
---

> 移植自 JetBrains/ThinkRail 的 `packages/pi-thinkrail-workflow/skills/setting-up-a-project`（MIT），
> 经 `dsh-plugin-thinkrail`（MIT）。

# Setting up a project — dispatcher

The single entry point for turning a project into a spec graph. Figure out which situation you're in, then
follow the matching skill — don't improvise the flow yourself. Existing code without a graph enters
this dispatcher even when the request is only to become familiar with the project. Preserve explicit
read-only limits and the downstream clarification/adoption/review steps; entering this skill alone
does not authorize overwriting documents.

## 1. Detect

Look at the workspace and use the spec tools (`spec_grep` / `spec_graph`):

- Is there already a spec graph? Confirm with an unfiltered spec query. A file named `SPEC.md` or `goal-and-requirements.md` only counts when it has the spec graph frontmatter; ordinary design documents are candidates to adopt. A filtered no-match or unknown-root error is not evidence of an empty graph.
- Is there real source code, or is the repo empty / near-empty (just a README or scaffolding)?

## 2. Route

| Situation | Follow |
|---|---|
| **Already has specs** | Don't redo it. Briefly offer to review/extend the graph (fill obvious gaps — a missing `architecture.md`, un-specced modules) or point at the `brainstorming` skill for feature work. Declined → stop. Accepted → **Graph extension** below. |
| **No specs · empty / near-empty repo** | The **`starting-a-new-project`** skill — interview the user to turn the idea into `goal-and-requirements.md`. |
| **No specs · real source code** | The **`importing-a-codebase`** skill — analyze the code + agent files and draft the first spec graph, asking only for intent the code can't reveal. |

Read and follow that skill's steps.

## Graph extension (no dedicated skill)

No skill covers extending an existing graph. If the offer is accepted: say so in one line, then align
and adapt to the user's request with your own judgment, holding the **writing-specs** bar.

## Handoff

Ends by naming exactly one of: **starting-a-new-project**, **importing-a-codebase**, or — when specs
already exist — the review/extend offer above (declined → stop; accepted → graph extension: a
one-line note that no skill covers it, then judgment against the **writing-specs** bar).
