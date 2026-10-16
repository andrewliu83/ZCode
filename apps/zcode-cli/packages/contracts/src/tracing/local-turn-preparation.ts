type PreparationStage =
  | "context"
  | "hooks"
  | "persistence"
  | "compaction"
  | "mcp"
  | "tools"
  | "request_assembly"
  | "execution";
const MAX_PREPARATION_OBSERVERS = 128;
const preparationNow = () => performance.timeOrigin + performance.now();
export interface LocalTurnPreparationFact {
  sessionId: string;
  turnId: string;
  id: string;
  stage: PreparationStage;
  start: number;
  end?: number;
  outcome?: "completed" | "failed" | "cancelled";
}
type Subscription = { publish: (fact: LocalTurnPreparationFact) => void; sequence: number };
// 仅保存观察回调，不保存业务输入或阶段事实；CLI recorder 独占事实与订阅生命周期。
const subscriptions = new Map<string, Subscription>();
const noop = () => {};
export function observeLocalTurnPreparation(
  inputId: string,
  publish: Subscription["publish"],
): () => void {
  if (subscriptions.size >= MAX_PREPARATION_OBSERVERS || subscriptions.has(inputId)) return noop;
  const subscription = { publish, sequence: 0 };
  subscriptions.set(inputId, subscription);
  return () => {
    if (subscriptions.get(inputId) === subscription) subscriptions.delete(inputId);
  };
}
export function beginLocalTurnPreparation(
  trace: { queryId?: string; sessionId?: string; turnId?: string },
  stage: PreparationStage,
): (outcome?: LocalTurnPreparationFact["outcome"]) => void {
  const subscription = trace.queryId ? subscriptions.get(trace.queryId) : undefined;
  if (!subscription || !trace.sessionId || !trace.turnId) return noop;
  const fact: LocalTurnPreparationFact = {
    sessionId: trace.sessionId,
    turnId: trace.turnId,
    id: `prepare:${subscription.sequence++}`,
    stage,
    start: preparationNow(),
  };
  const publish = (value: LocalTurnPreparationFact) => {
    // 观测回调失败不得改变 Core 的返回值或异常；首输出解绑后不再补采工具循环。
    if (subscriptions.get(trace.queryId!) !== subscription) return;
    try {
      subscription.publish(value);
    } catch {
      /* 本地诊断观察者不参与业务裁决。 */
    }
  };
  publish(fact);
  let ended = false;
  return (outcome = "completed") => {
    if (ended) return;
    ended = true;
    publish({ ...fact, end: preparationNow(), outcome });
  };
}
