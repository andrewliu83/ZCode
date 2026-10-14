import { create } from "zustand";

/** 只读提示词投影的失效信号，不保存正文或任何 Runtime 业务事实。 */
export const useSystemPromptInspectionStore = create<{ revision: number; invalidate: () => void }>(
  (set) => ({
    revision: 0,
    invalidate: () => set((state) => ({ revision: state.revision + 1 })),
  }),
);
