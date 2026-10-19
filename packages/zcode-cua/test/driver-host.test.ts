import { describe, expect, it, vi } from "vitest";
import {
  CuaHelperLifecycleManager,
  createCuaProductMcpServerResolver,
  buildHelperOpenArgs,
} from "../broker-server.js";

describe("CUA host lifecycle", () => {
  it("retains one admitted generation, coalesces acquisition, and disposes terminally", async () => {
    const dispose = vi.fn();
    const manager = new CuaHelperLifecycleManager(dispose);
    const value = { host: 1 };
    const create = vi.fn(() => value);
    const options = { create, isAdmitted: () => true, shouldRetainCurrent: () => true };
    expect(await Promise.all([manager.acquire(options), manager.acquire(options)])).toEqual([
      value,
      value,
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    await manager.dispose();
    await manager.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manager.peek()).toBeUndefined();
    expect(await manager.acquire(options)).toBeUndefined();
  });
  it("does not dispose an absent generation or create when not admitted", async () => {
    const dispose = vi.fn();
    const create = vi.fn();
    const manager = new CuaHelperLifecycleManager(dispose);
    expect(await manager.acquire({ create, isAdmitted: () => false })).toBeUndefined();
    await manager.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("launches the exact independent app without permission prompts or embedded attribution", () => {
    const args = buildHelperOpenArgs({
      appPath: "/fixed/CuaDriver.app",
      socketPath: "/private/native.sock",
    });
    expect(args).toContain("/fixed/CuaDriver.app");
    expect(args).toContain("--no-permissions-gate");
    expect(args).toContain("/private/native.sock");
    expect(args).not.toContain("--embedded");
  });
  it("deduplicates permission recovery without recycling the Agent", async () => {
    const host = {
      restart: vi.fn(async () => ({})),
      restartAfterCurrentStart: vi.fn(async () => ({})),
      start: vi.fn(),
    };
    const resolver = createCuaProductMcpServerResolver(host);
    await Promise.all([
      resolver.restartAfterPermissionGrant("a"),
      resolver.restartAfterPermissionGrant("a"),
    ]);
    await resolver.restartAfterPermissionGrant("a");
    expect(host.restartAfterCurrentStart).toHaveBeenCalledTimes(1);
  });
});
