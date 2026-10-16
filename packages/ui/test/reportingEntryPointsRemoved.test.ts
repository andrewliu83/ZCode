// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { RemoteConnectionConnectingStep } from "@/remote-connection/RemoteConnectionConnectingStep.js";
import { TaskActionMenuContent } from "@/TaskActionMenuContent.js";

afterEach(cleanup);

it("连接失败仍展示日志与重试、返回操作，不显示失效的反馈上传按钮", () => {
  const onBack = vi.fn();
  const onRetry = vi.fn();
  render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(RemoteConnectionConnectingStep, {
        kind: "ssh",
        logs: [{ id: "log-1", timestamp: "10:00", level: "error", message: "connection failed" }],
        errorMessage: "Connection refused",
        loading: false,
        onBack,
        onRetry,
      }),
    ),
  );
  expect(screen.getByText("Connection refused")).toBeTruthy();
  expect(screen.getByText("connection failed")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /反馈|feedback/i })).toBeNull();
  for (const button of screen.getAllByRole("button")) fireEvent.click(button);
  expect(onBack).toHaveBeenCalledOnce();
  expect(onRetry).toHaveBeenCalledOnce();
});

it("任务菜单忽略旧反馈回调，保留归档和复制日志操作", () => {
  const retiredCallback = vi.fn();
  const onArchiveTask = vi.fn();
  const onCopyTaskLogPath = vi.fn();
  const props: Parameters<typeof TaskActionMenuContent>[0] = {
    intl: { formatMessage: ({ id }) => id },
    isPinned: false,
    fileManagerLabel: "Finder",
    taskSessionFile: { loading: false, path: "/test/session.json", exists: true },
    taskNativeSessionLogFile: { loading: false, path: "/test/session.log", exists: true },
    providerConfigFile: { loading: false, path: null, exists: false },
    Item: ({ children, disabled, onSelect }) =>
      createElement("button", { disabled, onClick: onSelect }, children),
    Separator: () => createElement("hr"),
    onTogglePinTask: vi.fn(),
    onStartRenameTask: vi.fn(),
    onArchiveTask,
    onMarkTaskAsUnread: vi.fn(),
    onOpenTaskPathInFileManager: vi.fn(),
    onCopyWorkspacePath: vi.fn(),
    onCopyTaskPath: vi.fn(),
    onCopyTaskLogPath,
    onOpenProviderConfig: vi.fn(),
  };
  // 已安装的扩展即使携带旧属性，也不能恢复已删除的上传入口。
  const oldCallerProps = { onOpenTaskFeedback: retiredCallback };
  render(createElement(TaskActionMenuContent, { ...props, ...oldCallerProps }));
  expect(screen.queryByRole("button", { name: /feedback|反馈/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /archive/i }));
  fireEvent.click(screen.getByRole("button", { name: /copy.*log/i }));
  expect(onArchiveTask).toHaveBeenCalledOnce();
  expect(onCopyTaskLogPath).toHaveBeenCalledOnce();
  expect(retiredCallback).not.toHaveBeenCalled();
});
