// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LexicalChatInput, type LexicalChatInputHandle } from "@/LexicalChatInput.js";

vi.mock("@/SlashCommandPlugin.js", () => ({ SlashCommandPlugin: () => null }));
vi.mock("@/mentions/MentionPlugin.js", () => ({ MentionPlugin: () => null }));
vi.mock("@/v4/activeTaskProvider.js", () => ({ useChatViewActiveTaskProvider: () => "fixture" }));
vi.mock("@/shortcuts/useShortcutBindings.js", () => ({ useEffectiveShortcutBindings: () => [] }));
vi.mock("@/lib/uiPerfArmsTelemetry.js", () => ({ recordInputLag: () => {} }));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("real Lexical composer commit boundary", () => {
  it("clear immediately exposes empty Markdown and JSON, including a synchronous draft flush", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const api = createRef<LexicalChatInputHandle>();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const changes: { value: string; isCurrent: () => boolean }[] = [];
    await act(async () =>
      root.render(
        createElement(LexicalChatInput, {
          workspacePath: "/fixture",
          taskId: null,
          editorApiRef: api,
          onSubmit: () => false,
          enableMentionPanel: false,
          onChange: (value, change) => {
            if (change) changes.push({ value, isCurrent: change.isCurrent });
          },
        }),
      ),
    );
    await act(async () => {
      api.current!.setText("已发送正文");
    });
    expect(api.current!.getMarkdown()).toBe("已发送正文");
    let immediateText = "";
    let immediateJson = "";
    await act(async () => {
      api.current!.clear();
      immediateText = api.current!.getMarkdown();
      immediateJson = JSON.stringify(api.current!.getEditorState().toJSON());
    });
    expect(immediateText).toBe("");
    expect(immediateJson).not.toContain("已发送正文");
    expect(host.textContent).not.toContain("已发送正文");
    const oldChange = changes.find((change) => change.value === "已发送正文")!;
    expect(oldChange.isCurrent()).toBe(false);
    await act(async () => api.current!.setText("已发送正文"));
    expect(changes.at(-1)!.value).toBe("已发送正文");
    expect(changes.at(-1)!.isCurrent()).toBe(true);
    expect(oldChange.isCurrent()).toBe(false);
  });
});
