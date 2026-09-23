import { useCallback, useMemo, useRef, useState } from "react";
import type { FunnelConfig } from "@shared/funnel";

const TEXT_HISTORY_MS = 800;

export function useFunnelEditorHistory() {
  const [canUndo, setCanUndo] = useState(false);
  const stackRef = useRef<FunnelConfig[]>([]);
  const burstBaseRef = useRef<FunnelConfig | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const push = useCallback((snapshot: FunnelConfig) => {
    stackRef.current = [...stackRef.current, structuredClone(snapshot)].slice(-80);
    setCanUndo(stackRef.current.length > 0);
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    stackRef.current = [];
    burstBaseRef.current = null;
    setCanUndo(false);
  }, []);

  const record = useCallback((current: FunnelConfig, immediate: boolean) => {
    if (immediate) {
      clearTimer();
      if (burstBaseRef.current) {
        push(burstBaseRef.current);
        burstBaseRef.current = null;
      } else {
        push(current);
      }
      return;
    }
    burstBaseRef.current ??= structuredClone(current);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      if (burstBaseRef.current) push(burstBaseRef.current);
      burstBaseRef.current = null;
      timerRef.current = null;
    }, TEXT_HISTORY_MS);
  }, [push]);

  const undo = useCallback((): FunnelConfig | null => {
    clearTimer();
    burstBaseRef.current = null;
    const previous = stackRef.current.pop() ?? null;
    setCanUndo(stackRef.current.length > 0);
    return previous ? structuredClone(previous) : null;
  }, []);

  return useMemo(() => ({ canUndo, record, undo, reset }), [canUndo, record, undo, reset]);
}
