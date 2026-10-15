import { agentKernelDescriptorSchema, type AgentKernelDescriptor } from "@zcode/shared";
import type { NativeAgentKernelPort } from "@zcode/contracts";

export interface AgentKernelRegistration {
  descriptor: AgentKernelDescriptor;
  create?: () => NativeAgentKernelPort | Promise<NativeAgentKernelPort>;
}

/** Bootstrap 是内核装配 owner；Runtime 不依赖 SDK/未来 Pi 的具体 factory。 */
export class AgentKernelRegistry {
  readonly #registrations = new Map<string, AgentKernelRegistration>();
  constructor(registrations: readonly AgentKernelRegistration[]) {
    for (const registration of registrations) {
      const descriptor = agentKernelDescriptorSchema.parse(registration.descriptor);
      if (this.#registrations.has(descriptor.id))
        throw new Error(`Duplicate agent kernel: ${descriptor.id}`);
      if (descriptor.execution === "native" && !registration.create)
        throw new Error(`Agent kernel ${descriptor.id} requires a factory`);
      this.#registrations.set(descriptor.id, { ...registration, descriptor });
    }
  }
  descriptors(): AgentKernelDescriptor[] {
    return [...this.#registrations.values()].map((value) => ({ ...value.descriptor }));
  }
  has(id: string): boolean {
    return this.#registrations.has(id);
  }
  async create(id: string): Promise<NativeAgentKernelPort | undefined> {
    const registration = this.#registrations.get(id);
    if (!registration) throw new Error(`Unsupported agent kernel: ${id}`);
    return registration.create?.();
  }
}
