import { describe, expect, it, vi } from "vitest";
import { AgentKernelRegistry } from "../src/app/agent-kernel-registry.js";
import { resolveAgentKernelBinding } from "../src/app/agent-kernel.js";
import { createSessionId, type SessionStorePort } from "@zcode/contracts";
import { sessionConfigStateSchema } from "@zcode/shared/zcode-protocol-v4";

describe("registered agent kernels", () => {
  it("creates and restores a third registered implementation without a kernel-name switch", async () => {
    const port = { run: vi.fn() };
    const factory = vi.fn(() => port);
    const registry = new AgentKernelRegistry([
      {
        descriptor: {
          id: "zcode",
          label: "ZCode",
          execution: "builtin",
          prompt: "readable-default",
        },
      },
      {
        descriptor: {
          id: "fixture-agent",
          label: "Test Agent",
          execution: "native",
          prompt: "managed-preset",
        },
        create: factory,
      },
    ]);
    const id = createSessionId("registry-test");
    const store = {
      sessionEntries: async () => [
        {
          id: `agent-kernel:${id}`,
          data: { kernel: "fixture-agent", nativeSessionId: "native-1" },
        },
      ],
    } as unknown as SessionStorePort;
    const binding = await resolveAgentKernelBinding(store, id, true, "zcode", (key) =>
      registry.has(key),
    );
    expect(binding).toEqual({ kernel: "fixture-agent", nativeSessionId: "native-1" });
    expect(await registry.create(binding.kernel)).toBe(port);
    expect(factory).toHaveBeenCalledOnce();
    expect(
      sessionConfigStateSchema.parse({
        agentKernel: binding.kernel,
        availableAgentKernels: registry.descriptors(),
        provider: "",
        model: "",
        thought: "",
        followupMode: "queue",
      }).availableAgentKernels,
    ).toHaveLength(2);
    await expect(registry.create("missing")).rejects.toThrow("Unsupported agent kernel: missing");
    await expect(
      resolveAgentKernelBinding(store, id, false, "missing", (key) => registry.has(key)),
    ).rejects.toThrow("Unsupported agent kernel: missing");
  });
  it("rejects duplicate IDs and descriptors without an executable factory", () => {
    const descriptor = {
      id: "fixture-agent",
      label: "Test",
      execution: "native" as const,
      prompt: "managed-preset" as const,
    };
    expect(() => new AgentKernelRegistry([{ descriptor }])).toThrow("requires a factory");
    expect(
      () =>
        new AgentKernelRegistry([
          { descriptor, create: () => ({ run: vi.fn() }) },
          { descriptor, create: () => ({ run: vi.fn() }) },
        ]),
    ).toThrow("Duplicate agent kernel");
  });
});
