/**
 * ThinkRail spec 图快照 —— 面板与工具共用同一份形状（docs/thinkrail/design.md D7）。
 *
 * 面板**只读**：它消费的就是这里描述的派生视图，写入的唯一路径是 agent 的 spec_* 工具。
 * 快照由 Host 的 ISpecGraphService 从工作区文件系统现算，UI 不自己解析 spec 文件。
 */

/** 一个 spec 文件在快照里的投影：只带渲染需要的字段，不带正文。 */
export interface SpecGraphSnapshotNode {
  id: string;
  type: string;
  title?: string;
  /** 工作区相对路径，posix 分隔符。 */
  path: string;
  status?: string;
  /** 链接字段的原始值：parent 是单个 id，其余是 id 列表。 */
  parent?: string;
  dependsOn: string[];
  references: string[];
  implements: string[];
  covers: string[];
  tags: string[];
}

export interface SpecGraphSnapshotEdge {
  from: string;
  to: string;
  /** 链接种类：parent / depends-on / references / implements。 */
  kind: string;
}

export interface SpecGraphSnapshotIssue {
  kind: "dangling-link" | "duplicate-id" | "parent-cycle";
  /** 一句话说明，UI 直接渲染。 */
  message: string;
  /** 相关 spec 的工作区相对路径（悬挂链接给来源，重复 id 给全部，环给环上节点）。 */
  paths: string[];
}

export interface SpecGraphSnapshot {
  /** 工作区绝对路径；面板据此判断快照属于哪个工作区。 */
  workspacePath: string;
  /** 生成时刻（毫秒），面板显示「何时读的」。 */
  generatedAt: number;
  nodes: SpecGraphSnapshotNode[];
  edges: SpecGraphSnapshotEdge[];
  issues: SpecGraphSnapshotIssue[];
  /**
   * 这个工作区是否存在 spec。false 时 nodes/edges 为空、issues 也为空 ——
   * 「还没开始用 spec」与「用了但有问题」必须能分开，面板的空态文案不一样。
   */
  hasSpecs: boolean;
  /** 扫描时跳过的目录数（node_modules/.git/dist/build）；面板用它解释「为什么没看到」。 */
  skippedDirectoryCount: number;
}
