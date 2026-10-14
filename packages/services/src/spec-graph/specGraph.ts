import type { SpecGraphSnapshot } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * ThinkRail spec 图的只读服务（docs/thinkrail/design.md D7）。
 *
 * ## 为什么是服务而不是让 UI 自己解析
 *
 * spec 文件在工作区的**宿主**机器上（可能是 SSH/WSL/Docker 远端），解析它需要真实文件系统。
 * UI 只拿到派生快照；本地与远端因此走同一条链路，不为面板另开一条读取通道。
 *
 * ## 只读是结构性的，不是约定
 *
 * 这个接口上**没有**任何写入方法，也不该有：spec 的写入路径是 agent 的 spec_create /
 * spec_update / spec_delete 工具（那里有路径闸门、frontmatter 保护与确认门）。
 * 给面板加一个写方法等于绕开那三道。
 */
export interface ISpecGraphService {
  /**
   * 读一次工作区当前的 spec 图。
   *
   * 每次调用都现算（文件系统是唯一事实来源，没有缓存可失效）：面板是用户主动打开的，
   * 一次遍历的成本可以接受，而缓存会引入「面板显示的不是磁盘上的内容」这一类问题。
   * 工作区不存在 / 不是目录时返回空快照而不是抛错 —— 面板的空态比一个红框有用。
   */
  readSnapshot(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<SpecGraphSnapshot>;
}

export const ISpecGraphService = createServiceDescriptor<ISpecGraphService>(
  ServiceChannels.SpecGraph,
);
