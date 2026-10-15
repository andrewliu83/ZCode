import { z } from "zod";
import type {
  ModelInputMessage,
  ModelMessageContentBlock,
  ModelRequest,
  ModelToolChoice,
  ModelToolContract,
} from "@zcode/contracts";

const cacheControl = z.object({
  type: z.literal("ephemeral"),
  ttl: z.enum(["5m", "1h"]).optional(),
  scope: z.enum(["global", "org"]).optional(),
});
const blockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    signature: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    content: z.unknown().optional(),
    is_error: z.boolean().optional(),
    source: z.unknown().optional(),
    title: z.string().optional(),
    cache_control: cacheControl.optional(),
  })
  .strict();
const contentSchema = z.union([z.string(), z.array(blockSchema)]);
export const nativeMessagesSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(
      z.object({ role: z.enum(["user", "assistant", "system"]), content: contentSchema }).strict(),
    ),
    system: contentSchema.optional(),
    max_tokens: z.number().int().positive(),
    stream: z.boolean().optional(),
    tools: z
      .array(
        z
          .object({
            name: z.string().min(1),
            description: z.string().optional(),
            input_schema: z.record(z.string(), z.unknown()),
            type: z.literal("custom").optional(),
            cache_control: cacheControl.optional(),
            defer_loading: z.boolean().optional(),
            strict: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    tool_choice: z
      .object({
        type: z.enum(["auto", "any", "tool", "none"]),
        name: z.string().optional(),
        disable_parallel_tool_use: z.boolean().optional(),
      })
      .strict()
      .optional(),
    metadata: z.object({ user_id: z.string().optional() }).passthrough().optional(),
    thinking: z
      .object({
        type: z.enum(["enabled", "disabled", "adaptive"]),
        budget_tokens: z.number().optional(),
        display: z.string().optional(),
      })
      .passthrough()
      .optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    stop_sequences: z.array(z.string()).optional(),
    output_config: z
      .object({
        effort: z.string().optional(),
        format: z
          .object({ type: z.literal("json_schema"), schema: z.record(z.string(), z.unknown()) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    context_management: z.unknown().optional(),
  })
  .strict();
export type NativeMessagesBody = z.infer<typeof nativeMessagesSchema>;
type Block = z.infer<typeof blockSchema>;

function media(block: Block): ModelMessageContentBlock {
  const source = z
    .union([
      z.object({ type: z.literal("base64"), media_type: z.string(), data: z.string() }).strict(),
      z.object({ type: z.literal("url"), url: z.string().url() }).strict(),
      z.object({ type: z.literal("text"), media_type: z.string(), data: z.string() }).strict(),
    ])
    .parse(block.source);
  if (block.type === "image") {
    if (source.type !== "base64") throw new Error("The model gateway accepts embedded images only");
    return {
      type: "image",
      mediaType: source.media_type,
      dataUrl: `data:${source.media_type};base64,${source.data}`,
    };
  }
  return source.type === "base64"
    ? {
        type: "file",
        name: block.title,
        mediaType: source.media_type,
        dataUrl: `data:${source.media_type};base64,${source.data}`,
      }
    : source.type === "text"
      ? { type: "file", name: block.title, mediaType: source.media_type, text: source.data }
      : { type: "file", name: block.title, mediaType: "application/pdf", uri: source.url };
}
function content(blocks: Block[]): ModelMessageContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "text" && block.text !== undefined)
      return { type: "text" as const, text: block.text };
    if (block.type === "thinking" && block.thinking !== undefined)
      return { type: "reasoning" as const, text: block.thinking };
    if (["image", "document"].includes(block.type)) return media(block);
    throw new Error(`Unsupported model gateway content: ${block.type}`);
  });
}
function message(
  role: ModelInputMessage["role"],
  raw: z.infer<typeof contentSchema>,
  toolNames: Map<string, string>,
): ModelInputMessage[] {
  if (typeof raw === "string") return [{ role, content: raw }];
  const messages: ModelInputMessage[] = [];
  let ordinary: Block[] = [];
  let calls: NonNullable<ModelInputMessage["toolCalls"]> = [];
  const flush = (cacheControl?: Block["cache_control"]) => {
    if (ordinary.length || calls.length) {
      messages.push({
        role,
        content: content(ordinary),
        ...(calls.length ? { toolCalls: calls } : {}),
        ...(cacheControl ? { cacheControl } : {}),
      });
      ordinary = [];
      calls = [];
    }
  };
  for (const block of raw) {
    if (block.type === "tool_use") {
      if (role !== "assistant" || !block.id || !block.name)
        throw new Error("Invalid native tool call");
      toolNames.set(block.id, block.name);
      calls.push({ id: block.id, name: block.name, input: block.input ?? {} });
    } else if (block.type === "tool_result") {
      if (role !== "user" || !block.tool_use_id) throw new Error("Invalid native tool result");
      flush();
      const result =
        typeof block.content === "string"
          ? block.content
          : content(z.array(blockSchema).parse(block.content ?? []));
      const toolName = toolNames.get(block.tool_use_id);
      if (!toolName) throw new Error("Native tool result has no matching call");
      messages.push({
        role: "tool",
        content: result,
        toolCallId: block.tool_use_id,
        toolName,
        isError: block.is_error,
        ...(block.cache_control ? { cacheControl: block.cache_control } : {}),
      });
    } else ordinary.push(block);
    // 以显式缓存断点切分消息，保留稳定前缀，不把标记移动到后续动态内容。
    if (block.cache_control) flush(block.cache_control);
  }
  flush();
  return messages;
}
export function toGatewayModelRequest(body: NativeMessagesBody, signal: AbortSignal): ModelRequest {
  if (body.tool_choice?.disable_parallel_tool_use)
    throw new Error("This model gateway does not support disabling parallel calls");
  let toolChoice: ModelToolChoice | undefined;
  if (body.tool_choice)
    toolChoice =
      body.tool_choice.type === "any"
        ? "required"
        : body.tool_choice.type === "tool"
          ? { type: "tool", toolName: z.string().min(1).parse(body.tool_choice.name) }
          : body.tool_choice.type;
  const tools: ModelToolContract[] | undefined = body.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    strict: tool.strict,
    ...(tool.cache_control ? { cacheControl: tool.cache_control } : {}),
  }));
  const toolNames = new Map<string, string>();
  return {
    messages: [
      ...(body.system ? message("system", body.system, toolNames) : []),
      ...body.messages.flatMap((entry) => message(entry.role, entry.content, toolNames)),
    ],
    tools,
    toolChoice,
    temperature: body.temperature,
    topP: body.top_p,
    topK: body.top_k,
    stopSequences: body.stop_sequences,
    responseJsonSchema: body.output_config?.format?.schema,
    options: { maxOutputTokens: body.max_tokens },
    abortSignal: signal,
  };
}
