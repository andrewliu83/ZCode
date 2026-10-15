import { z } from "zod";

/** 内核 ID 是跨进程/持久化标识；注册校验归 Bootstrap，不在各层复制封闭枚举。 */
export const agentKernelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u);
export type AgentKernelId = z.infer<typeof agentKernelIdSchema>;

export const agentKernelDescriptorSchema = z
  .object({
    id: agentKernelIdSchema,
    label: z.string().min(1),
    execution: z.enum(["builtin", "native"]),
    prompt: z.enum(["readable-default", "managed-preset"]),
  })
  .strict();
export type AgentKernelDescriptor = z.infer<typeof agentKernelDescriptorSchema>;

/** 唯一发行清单；UI 也可以接收部署方的注册描述，不提前显示未实现的 Pi。 */
export const BUILT_IN_AGENT_KERNELS: readonly AgentKernelDescriptor[] = [
  { id: "zcode", label: "ZCode", execution: "builtin", prompt: "readable-default" },
  { id: "claude", label: "Claude", execution: "native", prompt: "managed-preset" },
];
