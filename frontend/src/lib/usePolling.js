import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Polls `fn` every `intervalMs` while `enabled` is true, stopping once
 * `stopWhen(result)` returns true (or on unmount / when disabled).
 */
export function usePolling(fn, { intervalMs = 2000, enabled = true, stopWhen = () => false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const stopWhenRef = useRef(stopWhen);
  stopWhenRef.current = stopWhen;

  const intervalRef = useRef(null);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    let cancelled = false;
    setIsPolling(true);

    const tick = async () => {
      try {
        const result = await fnRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        if (stopWhenRef.current(result)) {
          stop();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err);
        stop();
      }
    };

    tick();
    intervalRef.current = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, stop]);

  return { data, error, isPolling };
}
