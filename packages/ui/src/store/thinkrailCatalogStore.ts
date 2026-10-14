import { create } from "zustand";

/** 本地目录缓存的失效代次，不保存功能开关或任何 Host 业务事实。 */
export const useThinkrailCatalogStore = create<{
  revision: number;
  invalidate: () => void;
}>((set) => ({
  revision: 0,
  invalidate: () => set((state) => ({ revision: state.revision + 1 })),
}));
