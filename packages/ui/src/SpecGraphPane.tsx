/* oxlint-disable eslint(max-lines) -- spec 图面板集中承载工具栏、树、详情与问题区；交互稳定后再按区块拆分。 */
import { useMemo, useState } from "react";
import { AlertTriangleIcon, FileTextIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type { SpecGraphSnapshot, SpecGraphSnapshotNode } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { useSpecGraph } from "@/hooks/useSpecGraph.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

interface SpecGraphPaneProps {
  workspacePath: string;
  workspaceIdentity?: string;
  isVisible: boolean;
  onClose: () => void;
}

/**
 * ThinkRail spec 图面板（docs/thinkrail/design.md D7）。
 *
 * **只读**：这个组件没有写入路径，所有写操作经 agent 的 spec_create / spec_update /
 * spec_delete 工具（那里有路径闸门、frontmatter 保护与确认门）。加一个写按钮等于绕开那三道。
 *
 * 内容按 parent 链折成一棵树（spec 树本来就是这么组织的），没有 parent 的节点平铺在根部。
 * 选中一个节点看它的链接与元数据；问题区列出 validateGraph 的三类结构问题。
 */
export function SpecGraphPane({
  workspacePath,
  workspaceIdentity,
  isVisible,
  onClose,
}: SpecGraphPaneProps) {
  const { intl } = useZCodeIntl();
  const { snapshot, loading, error, refresh } = useSpecGraph({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    // 面板不可见时不读：折叠的 tab 不该继续占一次仓库遍历。
    enabled: isVisible,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tree = useMemo(() => buildSpecTree(snapshot), [snapshot]);
  const selected = useMemo(
    () => snapshot?.nodes.find((node) => node.id === selectedId) ?? null,
    [snapshot, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="spec-graph-pane">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ui-base font-medium">
            {intl.formatMessage({ id: "thinkrail.specGraph.title" })}
          </span>
          {snapshot && snapshot.hasSpecs ? (
            <span className="shrink-0 text-ui-sm text-text-tertiary">
              {intl.formatMessage(
                { id: "thinkrail.specGraph.summary" },
                { nodes: snapshot.nodes.length, issues: snapshot.issues.length },
              )}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={intl.formatMessage({ id: "thinkrail.specGraph.refresh" })}
            onClick={refresh}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={intl.formatMessage({ id: "sidePane.closeTab" }, { title: "" })}
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-ui-base text-text-tertiary">
            {intl.formatMessage({ id: "thinkrail.specGraph.loading" })}
          </p>
        ) : error !== null ? (
          <p className="px-3 py-4 text-ui-base text-destructive">
            {intl.formatMessage({ id: "thinkrail.specGraph.error" }, { message: error })}
          </p>
        ) : !snapshot || !snapshot.hasSpecs ? (
          <EmptyState snapshot={snapshot} />
        ) : (
          <>
            {snapshot.issues.length > 0 ? (
              <IssueList snapshot={snapshot} onSelect={setSelectedId} />
            ) : null}
            <ul className="py-1">
              {tree.map((entry) => (
                <SpecTreeRow
                  key={entry.node.id}
                  entry={entry}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {selected ? <SpecDetail node={selected} snapshot={snapshot} /> : null}
    </div>
  );
}

function EmptyState({ snapshot }: { snapshot: SpecGraphSnapshot | null }) {
  const { intl } = useZCodeIntl();
  return (
    <div className="px-3 py-6 text-ui-base text-text-tertiary">
      <p>{intl.formatMessage({ id: "thinkrail.specGraph.empty" })}</p>
      {snapshot && snapshot.skippedDirectoryCount > 0 ? (
        // 「为什么看不到某些文件」的答案：spec 放在被忽略的目录里时，用户看到的是这句话。
        <p className="mt-2 text-ui-sm">
          {intl.formatMessage(
            { id: "thinkrail.specGraph.skipped" },
            { count: snapshot.skippedDirectoryCount },
          )}
        </p>
      ) : null}
    </div>
  );
}

function IssueList({
  snapshot,
  onSelect,
}: {
  snapshot: SpecGraphSnapshot;
  onSelect: (id: string) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <section className="border-b border-border px-3 py-2">
      <h3 className="flex items-center gap-1.5 text-ui-sm font-medium text-text-secondary">
        <AlertTriangleIcon className="size-3.5 text-warning" />
        {intl.formatMessage(
          { id: "thinkrail.specGraph.issues" },
          { count: snapshot.issues.length },
        )}
      </h3>
      <ul className="mt-1 space-y-1">
        {snapshot.issues.map((issue, index) => {
          // 问题按路径可点：点到的是「出问题的那个 spec」，不是一段死文本。
          const firstPath = issue.paths[0];
          const nodeId = firstPath
            ? snapshot.nodes.find((node) => node.path === firstPath)?.id
            : undefined;
          return (
            <li key={`${issue.kind}-${index}`}>
              <button
                type="button"
                disabled={nodeId === undefined}
                onClick={() => nodeId !== undefined && onSelect(nodeId)}
                className={cn(
                  "w-full rounded-md px-1.5 py-1 text-left text-ui-sm",
                  nodeId === undefined
                    ? "cursor-default text-text-tertiary"
                    : "text-text-secondary hover:bg-surface-hover",
                )}
              >
                {issue.message}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface SpecTreeEntry {
  node: SpecGraphSnapshotNode;
  depth: number;
}

/**
 * 把节点折成一棵树。
 *
 * parent 指向一个不存在的 id（悬挂链接）时按根处理 —— 那份 spec 仍然要出现在面板里，
 * 它的问题由 issues 区报出，不能因为父节点缺失就把它从树上藏掉。
 */
function buildSpecTree(snapshot: SpecGraphSnapshot | null): SpecTreeEntry[] {
  if (!snapshot) return [];
  const childrenByParent = new Map<string, SpecGraphSnapshotNode[]>();
  const roots: SpecGraphSnapshotNode[] = [];
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  for (const node of snapshot.nodes) {
    if (node.parent === undefined || !ids.has(node.parent)) {
      roots.push(node);
      continue;
    }
    const siblings = childrenByParent.get(node.parent);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parent, [node]);
  }

  const entries: SpecTreeEntry[] = [];
  const visited = new Set<string>();
  const visit = (node: SpecGraphSnapshotNode, depth: number): void => {
    // parent 成环时（issues 里会报）这里必须停：否则遍历会无限递归。
    if (visited.has(node.id)) return;
    visited.add(node.id);
    entries.push({ node, depth });
    for (const child of childrenByParent.get(node.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // 环上的节点永远走不到根：收尾时把它们按根补进来，保证没有节点在面板里缺席。
  for (const node of snapshot.nodes) visit(node, 0);
  return entries;
}

function SpecTreeRow({
  entry,
  selectedId,
  onSelect,
}: {
  entry: SpecTreeEntry;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { node, depth } = entry;
  const isSelected = node.id === selectedId;
  return (
    <li>
      <button
        type="button"
        data-spec-id={node.id}
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: 12 + depth * 14 }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 py-1.5 pr-3 text-left transition-colors",
          isSelected ? "bg-surface-hover" : "hover:bg-surface-hover",
        )}
      >
        <FileTextIcon className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-base">{node.title ?? node.id}</span>
          <span className="block truncate text-ui-sm text-text-tertiary">{node.path}</span>
        </span>
        {node.status ? (
          <span className="shrink-0 rounded-full bg-surface-raised px-1.5 py-0.5 text-ui-sm text-text-tertiary">
            {node.status}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function SpecDetail({
  node,
  snapshot,
}: {
  node: SpecGraphSnapshotNode;
  snapshot: SpecGraphSnapshot | null;
}) {
  const { intl } = useZCodeIntl();
  const links = useMemo(() => describeLinks(node, snapshot), [node, snapshot]);
  return (
    <section className="shrink-0 border-t border-border px-3 py-2" data-testid="spec-graph-detail">
      <h3 className="truncate text-ui-base font-medium">{node.title ?? node.id}</h3>
      <dl className="mt-1 space-y-0.5 text-ui-sm text-text-secondary">
        <DetailRow
          label={intl.formatMessage({ id: "thinkrail.specGraph.field.id" })}
          value={node.id}
        />
        <DetailRow
          label={intl.formatMessage({ id: "thinkrail.specGraph.field.type" })}
          value={node.type}
        />
        <DetailRow
          label={intl.formatMessage({ id: "thinkrail.specGraph.field.path" })}
          value={node.path}
        />
        {node.status ? (
          <DetailRow
            label={intl.formatMessage({ id: "thinkrail.specGraph.field.status" })}
            value={node.status}
          />
        ) : null}
      </dl>
      {links.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-ui-sm text-text-secondary">
          {links.map((link) => (
            <li key={link} className="truncate">
              {link}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-text-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
    </div>
  );
}

/** 出边用 id → 出边的 kind 展示；指向不存在的 id 时标注「未找到」，与 issues 区互相印证。 */
function describeLinks(node: SpecGraphSnapshotNode, snapshot: SpecGraphSnapshot | null): string[] {
  if (!snapshot) return [];
  const known = new Set(snapshot.nodes.map((candidate) => candidate.id));
  const lines: string[] = [];
  const push = (kind: string, targets: readonly string[]): void => {
    for (const target of targets) {
      lines.push(`${kind} → ${target}${known.has(target) ? "" : " (未找到)"}`);
    }
  };
  if (node.parent !== undefined) push("parent", [node.parent]);
  push("depends-on", node.dependsOn);
  push("references", node.references);
  push("implements", node.implements);
  push("covers", node.covers);
  if (node.tags.length > 0) lines.push(`tags: ${node.tags.join(", ")}`);
  return lines;
}
