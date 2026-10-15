import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk/core";
import type { NativeAgentRequest, ModelMessageContentBlock } from "@zcode/contracts";

type SdkContent = Exclude<SDKUserMessage["message"]["content"], string>;

/** 使用现有附件解析结果，不再读取原始路径，确保发送与持久化采用同一不可变内容。 */
export function nativeSdkPrompt(
  request: NativeAgentRequest,
): string | AsyncIterable<SDKUserMessage> {
  if (!request.inputContent?.length) return request.prompt;
  const content: SdkContent = [
    { type: "text", text: request.prompt },
    ...request.inputContent.map(toSdkBlock),
  ];
  return (async function* () {
    yield {
      type: "user" as const,
      session_id: request.resumeSessionId ?? "",
      parent_tool_use_id: null,
      message: { role: "user" as const, content },
    };
  })();
}

function toSdkBlock(block: ModelMessageContentBlock): SdkContent[number] {
  if (block.type === "text") return block;
  if (block.type === "image") {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(block.mediaType))
      throw new Error("Unsupported Claude image format");
    return {
      type: "image",
      source: {
        type: "base64",
        data: base64Data(block.dataUrl),
        media_type: block.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      },
    };
  }
  if (block.type === "file" && block.mediaType === "application/pdf" && block.dataUrl) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64Data(block.dataUrl) },
      title: block.name,
    };
  }
  if (block.type === "file" && block.text !== undefined) return { type: "text", text: block.text };
  if (block.type === "file" && (block.uri || block.source?.path))
    return { type: "text", text: `Attached file: ${block.uri ?? block.source?.path}` };
  if (block.type === "resource_link")
    return { type: "text", text: `Attached resource: ${block.uri}` };
  throw new Error(`Claude SDK cannot accept attachment content type: ${block.type}`);
}

function base64Data(url: string): string {
  const match = /^data:[^;,]+;base64,([\s\S]+)$/u.exec(url);
  if (!match) throw new Error("Invalid SDK media data URL");
  return match[1]!;
}
