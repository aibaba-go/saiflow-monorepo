import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { BrandLoading } from "../../../components/BrandLoading";
import { usePageUrl } from "../../../components/OriginalPreview";
import { useT } from "../../../i18n";
import theme from "../theme.module.css";
import s from "./ImageViewer.module.css";

/** main `ImageViewer.vue` (FR-SYS-113): pinch to zoom around the fingers' midpoint,
 * double-tap to zoom or reset, drag when zoomed, swipe to change page when not; −/+ and a
 * percentage button that resets; wheel zoom and keys on desktop. Pages are the backend's
 * previews, fetched one at a time with the tenant header. */
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const BUTTON_STEP = 1.6;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_MOVE_PX = 8;
const TAP_MS = 350;
const DOUBLE_TAP_MS = 300;
const SWIPE_PX = 60;

type View = { s: number; x: number; y: number };
type Gesture =
  | { kind: "pan" | "swipe"; startX: number; startY: number; baseX: number; baseY: number }
  | { kind: "pinch"; startDist: number; baseS: number; baseX: number; baseY: number; midX: number; midY: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function ImageViewer({ fileId, pages, index = 0, alt = "", onIndex, onClose }: {
  fileId: string;
  pages: number;
  index?: number;
  alt?: string;
  onIndex?(index: number): void;
  onClose(): void;
}) {
  const t = useT();
  const total = Math.max(pages, 1);
  const [current, setCurrent] = useState(clamp(index, 0, total - 1));
  const src = usePageUrl(fileId, current + 1);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setViewState] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [animating, setAnimating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const tapStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTap = useRef({ time: 0, x: 0, y: 0 });

  const setView = useCallback((v: View, animate: boolean) => {
    viewRef.current = v;
    setAnimating(animate);
    setViewState(v);
  }, []);

  const toStage = (clientX: number, clientY: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  const clampPan = useCallback((sc: number, x: number, y: number) => {
    const r = stage.current?.getBoundingClientRect();
    const el = img.current;
    if (!r || !el) return { x: 0, y: 0 };
    const mx = Math.max(0, (el.offsetWidth * sc - r.width) / 2);
    const my = Math.max(0, (el.offsetHeight * sc - r.height) / 2);
    return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
  }, []);

  const zoomAt = useCallback(
    (s1: number, px: number, py: number, animate: boolean) => {
      const v = viewRef.current;
      const sc = clamp(s1, MIN_SCALE, MAX_SCALE);
      const k = sc / v.s;
      const p = clampPan(sc, px - (px - v.x) * k, py - (py - v.y) * k);
      setView({ s: sc, x: p.x, y: p.y }, animate);
    },
    [clampPan, setView],
  );
  const zoomBy = useCallback((f: number) => zoomAt(viewRef.current.s * f, 0, 0, true), [zoomAt]);
  const resetView = useCallback((animate = true) => setView({ s: 1, x: 0, y: 0 }, animate), [setView]);

  const settle = useCallback(() => {
    const v = viewRef.current;
    if (v.s <= MIN_SCALE + 0.01) return resetView(true);
    const sc = clamp(v.s, MIN_SCALE, MAX_SCALE);
    const p = clampPan(sc, v.x, v.y);
    if (sc !== v.s || p.x !== v.x || p.y !== v.y) setView({ s: sc, x: p.x, y: p.y }, true);
  }, [clampPan, resetView, setView]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= total || next === current) return resetView(true);
      setCurrent(next);
      setLoaded(false);
      setFailed(false);
      resetView(false);
      onIndex?.(next);
    },
    [current, total, resetView, onIndex],
  );

  function startSingle(x: number, y: number) {
    const v = viewRef.current;
    gesture.current = { kind: v.s > MIN_SCALE + 0.01 ? "pan" : "swipe", startX: x, startY: y, baseX: v.x, baseY: v.y };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      stage.current?.setPointerCapture(e.pointerId);
    } catch {
      // some WebViews throw for a stale pointer id; the gesture still works
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimating(false);
    if (pointers.current.size === 1) {
      moved.current = false;
      tapStart.current = { x: e.clientX, y: e.clientY, time: Date.now() };
      startSingle(e.clientX, e.clientY);
    } else if (pointers.current.size === 2) {
      tapStart.current = null;
      moved.current = true;
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
      const v = viewRef.current;
      gesture.current = {
        kind: "pinch",
        startDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
        baseS: v.s,
        baseX: v.x,
        baseY: v.y,
        midX: mid.x,
        midY: mid.y,
      };
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId) || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
      const sc = clamp((g.baseS * dist) / g.startDist, MIN_SCALE * 0.8, MAX_SCALE);
      const k = sc / g.baseS;
      setView({ s: sc, x: mid.x - (g.midX - g.baseX) * k, y: mid.y - (g.midY - g.baseY) * k }, false);
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.hypot(dx, dy) > TAP_MOVE_PX) moved.current = true;
    if (g.kind === "pan") {
      const p = clampPan(viewRef.current.s, g.baseX + dx, g.baseY + dy);
      setView({ s: viewRef.current.s, x: p.x, y: p.y }, false);
    } else if (total > 1) {
      setView({ s: 1, x: dx, y: 0 }, false);
    }
  }

  function insideImage(x: number, y: number) {
    const r = img.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function handleTap(e: ReactPointerEvent<HTMLDivElement>) {
    const now = Date.now();
    const last = lastTap.current;
    if (now - last.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      lastTap.current = { time: 0, x: 0, y: 0 };
      if (viewRef.current.s > MIN_SCALE + 0.05) resetView(true);
      else {
        const p = toStage(e.clientX, e.clientY);
        zoomAt(DOUBLE_TAP_SCALE, p.x, p.y, true);
      }
      return;
    }
    lastTap.current = { time: now, x: e.clientX, y: e.clientY };
    if (viewRef.current.s <= MIN_SCALE + 0.01 && !insideImage(e.clientX, e.clientY)) onClose();
  }

  function endPointer(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()] as [{ x: number; y: number }];
      const v = viewRef.current;
      gesture.current = { kind: "pan", startX: p.x, startY: p.y, baseX: v.x, baseY: v.y };
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!cancelled && g?.kind === "swipe" && moved.current && total > 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        goTo(current + (dx < 0 ? 1 : -1));
        return;
      }
    }
    if (!cancelled && tapStart.current && !moved.current && Date.now() - tapStart.current.time < TAP_MS) handleTap(e);
    tapStart.current = null;
    settle();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goTo(current - 1);
      else if (e.key === "ArrowRight") goTo(current + 1);
      else if (e.key === "+" || e.key === "=") zoomBy(BUTTON_STEP);
      else if (e.key === "-") zoomBy(1 / BUTTON_STEP);
      else if (e.key === "0") resetView(true);
    };
    const prevent = (e: Event) => e.preventDefault(); // iOS page-level zoom
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", settle);
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("gesturechange", prevent);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", settle);
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
    };
  }, [current, goTo, onClose, resetView, settle, zoomBy]);

  const cx = (...n: (string | false)[]) => n.filter(Boolean).map((k) => s[k as string] ?? k).join(" ");
  return createPortal(
    <div className={`${theme.tokens} ${s.iv}`} role="dialog" aria-modal="true" aria-label={alt}>
      <div
        ref={stage}
        className={s["iv-stage"]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onWheel={(e) => {
          const p = toStage(e.clientX, e.clientY);
          zoomAt(viewRef.current.s * Math.exp(-e.deltaY * 0.0015), p.x, p.y, false);
        }}
      >
        {src && (
          <img
            ref={img}
            key={src}
            className={cx("iv-img", animating && "animating", loaded && "ready")}
            src={src}
            alt={alt}
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})` }}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
        {!loaded && !failed && (
          <div className={s["iv-loading"]}>
            <BrandLoading variant="inline" label={t("common.loading")} />
          </div>
        )}
        {failed && <p className={s["iv-error"]}>{t("viewer.loadFailed")}</p>}
      </div>

      <div className={s["iv-top"]}>
        {total > 1 && (
          <span className={s["iv-count"]}>
            {current + 1} / {total}
          </span>
        )}
        <button type="button" className={cx("iv-round", "iv-close")} aria-label={t("common.close")} onClick={onClose}>
          ×
        </button>
      </div>

      {total > 1 && current > 0 && (
        <button type="button" className={cx("iv-round", "iv-nav", "prev")} aria-label={t("viewer.prev")} onClick={() => goTo(current - 1)}>
          ‹
        </button>
      )}
      {total > 1 && current < total - 1 && (
        <button type="button" className={cx("iv-round", "iv-nav", "next")} aria-label={t("viewer.next")} onClick={() => goTo(current + 1)}>
          ›
        </button>
      )}

      <div className={s["iv-bottom"]}>
        <div className={s["iv-tools"]}>
          <button type="button" className={s["iv-tool"]} disabled={view.s <= MIN_SCALE + 0.01} aria-label={t("viewer.zoomOut")} onClick={() => zoomBy(1 / BUTTON_STEP)}>
            −
          </button>
          <button type="button" className={cx("iv-tool", "iv-pct")} aria-label={t("viewer.reset")} onClick={() => resetView(true)}>
            {Math.round(view.s * 100)}%
          </button>
          <button type="button" className={s["iv-tool"]} disabled={view.s >= MAX_SCALE - 0.01} aria-label={t("viewer.zoomIn")} onClick={() => zoomBy(BUTTON_STEP)}>
            +
          </button>
        </div>
        <div className={s["iv-hint"]}>{t("viewer.hint")}</div>
      </div>
    </div>,
    document.body,
  );
}
