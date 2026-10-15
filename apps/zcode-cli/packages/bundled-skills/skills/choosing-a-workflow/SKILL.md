---
name: choosing-a-workflow
description: "Use FIRST when any new piece of work arrives — a request, feature, change, fix, question, or idea — before starting on it or choosing an approach. Not for continuing work already routed to a workflow skill."
---

> 移植自 JetBrains/ThinkRail 的 `packages/pi-thinkrail-workflow/skills/choosing-a-workflow`（MIT），
> 经 `dsh-plugin-thinkrail`（MIT）。

# Choosing a Workflow

The root router of the workflow family, shipped with the ZCode CLI's bundled skills. It classifies the
incoming work and names the workflow skill that governs it — nothing more. A routed skill's steps live in
that skill alone; read it, don't run it from memory.

## Confirm onboarding before a read-only fallback

**Existing code without a spec graph takes priority.** Before choosing `no matching workflow`,
confirm the workspace state using the available spec tools. Use an unfiltered `spec_grep` query
(for example `{"pattern":".","regex":true,"limit":1}` without metadata filters); a filtered search with no matches or a
`spec_graph` error for an unknown root does not prove the graph is empty. Only use `spec_graph`
when a real node id is known. If the query fails, report the failure instead of treating it as no graph.

When real source code exists and the spec graph is confirmed absent, read and follow
**setting-up-a-project**, even for a read-only request such as "familiarize yourself with this project"
or "请熟悉当前项目". That dispatcher owns the next step: **importing-a-codebase** for existing code.
Do not choose `no matching workflow` solely because the request does not change code. If later spec
queries reveal that the graph is absent, re-route through **setting-up-a-project** before continuing.

Entering the workflow does not itself authorize overwriting files: preserve explicit user read-only
constraints and follow its intent clarification, document adoption and review steps. Ordinary Markdown
documents without spec frontmatter are adoption candidates, not proof that a spec graph already exists.
With an existing graph, use the normal request classification below and do not initialize it again.

## Classify

Read the request and the workspace, then answer three questions — usually silently, from what is already
in front of you:

1. **Is this project onboarding?** No spec graph yet — an empty (or effectively empty) workspace where
   the user brings a raw idea, or an existing codebase with no spec graph, including a request only
   to become familiar with that codebase.
2. **Is this the PR lifecycle?** Finished work shipping as a pull request, or an existing PR being
   tended — created, brought up to date, given screenshots, its checks watched, its review comments
   addressed. Fixes that flow from a PR's own review comments belong here, not to feature work.
3. **Does the work create or change anything in the project?** A new feature, added functionality, a
   behavior change, a nontrivial design decision — anything that alters what the project is or does.

If the route is genuinely ambiguous from the request alone, ask one short clarifying question
(`AskUserQuestion`, composed per the **asking-user-questions** concept skill) rather than guessing.

## Route

| Classification | Route |
|---|---|
| Project onboarding — confirmed no spec graph: an empty workspace with a raw idea, or any existing codebase, including read-only familiarization | Read and follow **setting-up-a-project** — a dispatcher that routes on the workspace's state |
| The PR lifecycle — finished work to ship as a pull request, or an existing PR to tend: create, bring up to date, screenshots, checks, review comments | Read and follow **shipping-a-pr** |
| The work creates or changes anything in the project — a new feature, added functionality, a behavior change, a nontrivial design decision | Read and follow **brainstorming** — however small it looks; that skill owns the "too small" judgment |
| Anything else, after ruling out onboarding — answering questions, explaining code, running commands or checks, work that changes nothing | **No matching workflow.** Say so in one line (e.g. "No workflow skill covers this; proceeding directly.") and proceed with your own judgment. Never stretch a route to fit — a forced route is worse than none. |

One route per piece of work. If a request bundles work from different rows (e.g. "explain X, then
change Y"), route the part that changes the project and handle the rest directly.

## Red flags — stop and re-route

- You chose a read-only fallback before checking whether existing code lacks a spec graph, or kept that fallback after discovering no graph — re-route through setting-up-a-project.
- You started designing or editing before naming a route — routing comes first.
- You are following a routed skill's steps from memory instead of reading that skill.
- You classed a change as "anything else" because it looked small or mechanical — size is
  brainstorming's call, not the router's.

## Handoff

This skill ends by naming exactly one of: **setting-up-a-project**, **shipping-a-pr**,
**brainstorming**, or **no matching workflow** (proceed with judgment). Adding a workflow to the family
adds a row to the table above and a skill beside it — the family is a first-party part of ZCode, not an
editable plugin.
