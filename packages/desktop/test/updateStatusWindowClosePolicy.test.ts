import { describe, expect, it } from "vitest";
import { resolveUpdateStatusWindowClosable } from "../src/main/updateStatusWindowClosePolicy.js";

describe("update status window close policy", () => {
  it("locks the window while a download or install is pending", () => {
    expect(resolveUpdateStatusWindowClosable({ kind: "download-progress" } as never, false)).toBe(
      false,
    );
    expect(resolveUpdateStatusWindowClosable({ kind: "update-downloaded" } as never, false)).toBe(
      false,
    );
  });

  it("keeps the window closable for non-install states", () => {
    for (const kind of ["idle", "checking", "update-available", "error"]) {
      expect(resolveUpdateStatusWindowClosable({ kind } as never, false)).toBe(true);
    }
  });

  // 回归依据：0.1.6 上“重启以更新”卡死，安装助手等待父进程超时后放弃
  // （community-update-install.log: Main did not exit）。原因是允许真正退出后
  // 该窗口仍被锁为不可关闭，app.quit() 无法完成。
  it("always allows closing once a real quit is requested", () => {
    expect(resolveUpdateStatusWindowClosable({ kind: "download-progress" } as never, true)).toBe(
      true,
    );
    expect(resolveUpdateStatusWindowClosable({ kind: "update-downloaded" } as never, true)).toBe(
      true,
    );
  });
});
