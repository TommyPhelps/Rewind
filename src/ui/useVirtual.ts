import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Tracks a scroll container's size and position so only visible rows are rendered. */
export function useViewport(ref: RefObject<HTMLElement | null>) {
  const [vp, setVp] = useState({ top: 0, height: 600, width: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [ref]);
  return vp;
}

/** Root font size in px (tracks the UI-scale setting), for converting rem row heights. */
export function useRemPx(dep: unknown): number {
  const [px, setPx] = useState(14);
  useEffect(() => {
    setPx(parseFloat(getComputedStyle(document.documentElement).fontSize) || 14);
  }, [dep]);
  return px;
}

export function visibleRange(count: number, rowH: number, top: number, height: number, overscan = 8) {
  const start = Math.max(0, Math.floor(top / rowH) - overscan);
  const end = Math.min(count, Math.ceil((top + height) / rowH) + overscan);
  return { start, end };
}
