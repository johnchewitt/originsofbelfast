import { useEffect, useRef, useState } from "react";

/** Returns `value`, updated at most once per `interval` ms (trailing edge kept). */
export function useThrottled<T>(value: T, interval: number): T {
  const [throttled, setThrottled] = useState(value);
  const last = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const now = performance.now();
    const wait = interval - (now - last.current);
    if (wait <= 0) {
      last.current = now;
      setThrottled(value);
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      last.current = performance.now();
      setThrottled(value);
      timer.current = null;
    }, wait);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [value, interval]);
  return throttled;
}
