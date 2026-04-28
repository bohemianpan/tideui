'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
  type CSSProperties,
} from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 0.4; // px/ms (non-snap dismiss)
const SCROLL_LOCK_TIMEOUT = 300;
const SNAP_SPRING_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SNAP_SPRING_DURATION = 300; // ms
const EXIT_DURATION = 300; // ms
const FLICK_VELOCITY = 0.3; // px/ms, snap-mode flick threshold
const DISMISS_OVERSHOOT = 60; // px below lowest snap required to close
const INTENT_THRESHOLD = 5; // px, drag-vs-scroll decision threshold

// ---------------------------------------------------------------------------
// Snap index helpers (pure)
// ---------------------------------------------------------------------------

/** Given a target pixel height and the sorted `effective` heights array,
 *  return the LOWEST index whose effective height matches. When two or more
 *  snaps collapse to the same effective height (because content is shorter
 *  than the taller snap fractions), they share a single user-facing position;
 *  we canonicalize to the lowest index so `onSnap` reports a stable value.
 *  `effective` is monotonically non-decreasing. */
function resolveSettledIdx(targetHeight: number, effective: number[]): number {
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] >= targetHeight - 0.5) return i;
  }
  return effective.length - 1;
}

/** Return the next index greater than `fromIdx` whose effective height is
 *  strictly larger than `effective[fromIdx]`. If no such index exists (all
 *  higher snaps have collapsed to the current effective height), returns
 *  `fromIdx` — callers treat that as a no-op. */
function nextDistinctIdx(fromIdx: number, effective: number[]): number {
  const current = effective[fromIdx];
  for (let i = fromIdx + 1; i < effective.length; i++) {
    if (effective[i] > current + 0.5) return i;
  }
  return fromIdx;
}

// ---------------------------------------------------------------------------
// Style injection (idempotent)
// ---------------------------------------------------------------------------

const STYLE_ID = 'tideui-bottomsheet';

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@keyframes tideui-slide-up {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
@keyframes tideui-slide-down {
  from { transform: translateY(0); }
  to   { transform: translateY(100%); }
}
@keyframes tideui-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes tideui-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Context for BottomSheet.Header
// ---------------------------------------------------------------------------

const HeaderRefContext = createContext<((el: HTMLDivElement | null) => void) | null>(null);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Height applied as inline style, e.g. "70vh", "calc(100% - 60px)".
   *  When omitted, height is auto (content-driven).
   *  Only used when `snapPoints` is NOT provided. */
  height?: string;
  /** If true, `height` is applied as maxHeight instead of height. Default: false.
   *  Only used when `snapPoints` is NOT provided. */
  heightIsMax?: boolean;
  /** Where swipe-to-dismiss is detected.
   *  "header" = only the drag handle + BottomSheet.Header area.
   *  "sheet"  = entire sheet, scroll-aware (blocks drag when inner content is scrolled).
   *  Default: "sheet" */
  swipeTarget?: 'header' | 'sheet';
  /** Extra class name applied to the sheet container div. */
  className?: string;
  /** z-index of the root overlay. Default: 2000 */
  zIndex?: number;
  /** Snap point fractions of viewport height (0-1), e.g. [0.3, 0.6, 1.0].
   *  Sorted ascending internally. When provided, the sheet opens at the
   *  `defaultSnapPoint` height and snaps between these positions on drag. */
  snapPoints?: number[];
  /** Index into `snapPoints` for the initial snap position. Default: 0 */
  defaultSnapPoint?: number;
  /** Called when the sheet settles at a snap point. */
  onSnap?: (index: number, snapValue: number) => void;
}

/** Imperative handle exposed via `ref`. Obtain by typing your ref as
 *  `useRef<BottomSheetHandle>(null)` and passing it to `<BottomSheet ref={...} />`. */
export interface BottomSheetHandle {
  /** Programmatically move the sheet to a snap index, reusing the same spring
   *  animation as a drag-release snap.
   *
   *  Safely no-ops when the sheet is not mounted, is closing, when `snapPoints`
   *  was not provided, or when the resolved target already matches the current
   *  snap. Out-of-range indices are clamped to `[0, snapPoints.length - 1]`.
   *
   *  The target height is also clamped to the sheet's content-fit ceiling:
   *  if `snapPoints[index]` is taller than the current content needs, the
   *  sheet settles at the content-fit height instead, and `onSnap` fires
   *  with the lowest-index snap that matches that height. Consumers tracking
   *  snap position via `onSnap` will therefore observe fewer distinct indices
   *  when the sheet's content is short.
   *
   *  @param index  Target snap index (clamped).
   *  @param opts   `animate: false` moves instantly without the spring.
   *                `onSnap` still fires. Default: animated. */
  snapTo(index: number, opts?: { animate?: boolean }): void;
}

// ---------------------------------------------------------------------------
// BottomSheet component
// ---------------------------------------------------------------------------

const BottomSheetInner = forwardRef<BottomSheetHandle, BottomSheetProps>(function BottomSheetInner({
  isOpen,
  onClose,
  children,
  height,
  heightIsMax = false,
  swipeTarget = 'sheet',
  className,
  zIndex = 2000,
  snapPoints: snapPointsProp,
  defaultSnapPoint = 0,
  onSnap,
}, ref) {
  useEffect(() => { injectStyles(); }, []);

  // -----------------------------------------------------------------------
  // Snap configuration
  // -----------------------------------------------------------------------
  const hasSnap = snapPointsProp != null && snapPointsProp.length > 0;
  const sortedSnaps = useMemo(
    () => hasSnap ? [...snapPointsProp!].sort((a, b) => a - b) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasSnap, ...(snapPointsProp ?? [])],
  );

  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const snapHeightsPx = useMemo(
    () => (hasSnap && sortedSnaps ? sortedSnaps.map(f => f * viewportHeight) : null),
    [hasSnap, sortedSnaps, viewportHeight],
  );

  // -----------------------------------------------------------------------
  // Content-required height (for clamping taller snaps to content)
  //
  // `contentRequiredPx` is the measured natural pixel height of the sheet's
  // contents — including the handle wrapper and the safe-area spacer. When
  // any direct flex child is "stretchy" (computed `flex-grow > 0`), the
  // consumer has opted into fill-available-space semantics and content
  // clamping is disabled (`null`).
  // -----------------------------------------------------------------------
  const [contentRequiredPx, setContentRequiredPx] = useState<number | null>(null);

  /** Effective snap heights = `snapHeightsPx[i]` clamped to `contentRequiredPx`.
   *  Monotonically non-decreasing (inherits `sortedSnaps` order). This is the
   *  array every downstream consumer uses — initial height, drag clamp,
   *  drag-release snap picker, imperative `snapTo`, pill advance, backdrop
   *  opacity denominator, exit transition. */
  const effectiveSnapHeightsPx = useMemo(() => {
    if (!snapHeightsPx) return null;
    if (contentRequiredPx == null || contentRequiredPx <= 0) return snapHeightsPx;
    return snapHeightsPx.map(h => Math.min(h, contentRequiredPx));
  }, [snapHeightsPx, contentRequiredPx]);
  const effectiveSnapHeightsPxRef = useRef<number[] | null>(null);
  effectiveSnapHeightsPxRef.current = effectiveSnapHeightsPx;

  // -----------------------------------------------------------------------
  // Mount / unmount state machine
  // -----------------------------------------------------------------------
  const [mounted, setMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setIsClosing(false);
      setHasEntered(false);
    } else if (mounted) {
      setIsClosing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
    if (!isClosing) setHasEntered(true);
  }, [isClosing]);

  // Exit teardown — wait for the close transition to finish, then unmount.
  // - Listen for `transitionend` (animation completes naturally) AND
  //   `transitioncancel` (a consumer re-render or ResizeObserver callback
  //   during exit re-applies the style and the browser fires cancel
  //   instead of end). Either signals the close has finished as far as
  //   we're concerned.
  // - If the sheet is already at the close-target value when isClosing
  //   flips (e.g. swipe-to-dismiss dragged height to ~0 before onClose
  //   ran), no transition will fire at all. Detect that synchronously
  //   and unmount on the next microtask so we don't hang on an event
  //   that won't arrive.
  useEffect(() => {
    if (!isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const atCloseTarget = hasSnap
      ? sheetHeightPxRef.current <= 0.5
      : translateYRef.current >= sheet.getBoundingClientRect().height - 0.5;
    if (atCloseTarget) {
      queueMicrotask(() => {
        setMounted(false);
        setIsClosing(false);
      });
      return;
    }
    const targetProp = hasSnap ? 'height' : 'transform';
    const onDone = (e: TransitionEvent) => {
      if (e.target !== sheet) return;
      if (e.propertyName !== targetProp) return;
      sheet.removeEventListener('transitionend', onDone);
      sheet.removeEventListener('transitioncancel', onDone);
      setMounted(false);
      setIsClosing(false);
    };
    sheet.addEventListener('transitionend', onDone);
    sheet.addEventListener('transitioncancel', onDone);
    return () => {
      sheet.removeEventListener('transitionend', onDone);
      sheet.removeEventListener('transitioncancel', onDone);
    };
  }, [isClosing, hasSnap]);

  // -----------------------------------------------------------------------
  // Snap-mode state (height in pixels drives everything)
  // -----------------------------------------------------------------------
  const [currentSnapIndex, setCurrentSnapIndex] = useState(defaultSnapPoint);
  const currentSnapIndexRef = useRef(defaultSnapPoint);
  const [sheetHeightPx, setSheetHeightPx] = useState(0);
  const sheetHeightPxRef = useRef(0);
  sheetHeightPxRef.current = sheetHeightPx;

  // Sync height on open and when snap config changes
  useEffect(() => {
    if (!hasSnap || !snapHeightsPx) return;
    // Use the latest effective heights if they've been measured; otherwise
    // fall back to raw snap heights (content-clamp effect will re-sync on
    // the next layout pass).
    const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
    if (isOpen) {
      const rawIdx = Math.max(0, Math.min(defaultSnapPoint, eff.length - 1));
      const targetH = eff[rawIdx];
      // Canonicalize the stored index so collapsed requests settle on the
      // lowest equivalent snap (keeps onSnap reporting stable).
      const settled = resolveSettledIdx(targetH, eff);
      currentSnapIndexRef.current = settled;
      setCurrentSnapIndex(settled);
      sheetHeightPxRef.current = targetH;
      setSheetHeightPx(targetH);
    } else if (mounted) {
      setSheetHeightPx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasSnap, defaultSnapPoint, viewportHeight]);

  // -----------------------------------------------------------------------
  // Drag state
  // -----------------------------------------------------------------------
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);
  // Refs mirror drag/snap state so measurement (called from ResizeObserver
  // and other async sources) can bail out during active gestures without
  // capturing stale closures.
  const isDraggingRef = useRef(false);
  isDraggingRef.current = isDragging;
  const isSnappingRef = useRef(false);
  isSnappingRef.current = isSnapping;
  /** Forces `transition: none` for a single snap change driven by
   *  `snapTo(..., { animate: false })`. Cleared on the next frame. */
  const [disableTransition, setDisableTransition] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerElRef = useRef<HTMLDivElement | null>(null);
  /** Pill button element used to exclude it from the sheet's drag handler. */
  const pillButtonRef = useRef<HTMLButtonElement>(null);

  const dragStartY = useRef(0);
  const dragStartTime = useRef(0);
  const dragStartHeightPx = useRef(0);
  const translateYRef = useRef(0);
  const isDragAllowed = useRef(false);
  const lastScrollTime = useRef(0);
  const lastFrameY = useRef(0);
  const lastFrameTime = useRef(0);
  const frameVelocity = useRef(0); // px/ms, positive = moving up

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;

  const setHeaderEl = useCallback((el: HTMLDivElement | null) => {
    headerElRef.current = el;
  }, []);

  // -----------------------------------------------------------------------
  // Content measurement → contentRequiredPx
  //
  // Measures the sheet's natural content height by temporarily switching its
  // inline style to `height: auto` inside a synchronous useLayoutEffect
  // (also triggered by a ResizeObserver for async size changes such as
  // images loading). When any direct flex child has computed flex-grow > 0,
  // the consumer has opted into fill-available-space semantics and content
  // clamping is disabled.
  // -----------------------------------------------------------------------
  const measureContent = useCallback(() => {
    if (!hasSnap) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    // Don't interfere with in-progress drag/snap transitions.
    if (isDraggingRef.current || isSnappingRef.current) return;

    // If any direct flex child is stretchy, skip clamping entirely.
    for (let i = 0; i < sheet.children.length; i++) {
      const child = sheet.children[i] as HTMLElement;
      const cs = getComputedStyle(child);
      if (parseFloat(cs.flexGrow || '0') > 0) {
        // Sync ref alongside the state update so synchronous readers (touch
        // handlers) see the unclamped heights immediately, not on next render.
        effectiveSnapHeightsPxRef.current = snapHeightsPx ?? null;
        setContentRequiredPx(prev => (prev == null ? prev : null));
        return;
      }
    }

    // Temporarily let the sheet size to content so offsetHeight reflects
    // the natural "would-be" height. Transition is suppressed for the
    // duration of the read so browsers cannot kick off a height animation
    // keyed off the ephemeral `auto` computed value.
    const savedHeight = sheet.style.height;
    const savedTransition = sheet.style.transition;
    sheet.style.transition = 'none';
    sheet.style.height = 'auto';
    const natural = sheet.offsetHeight;
    sheet.style.height = savedHeight;
    sheet.style.transition = savedTransition;

    // Sync ref so a touchstart-triggered measure makes the new effective
    // heights visible to handleTouchMove on the same gesture (state-driven
    // re-render is async and would otherwise leave the touchmove clamping
    // against the previous content's max).
    if (snapHeightsPx) {
      effectiveSnapHeightsPxRef.current = snapHeightsPx.map(h => Math.min(h, natural));
    }
    setContentRequiredPx(prev =>
      (prev != null && Math.abs(prev - natural) < 0.5) ? prev : natural,
    );
  }, [hasSnap, snapHeightsPx]);

  // Re-measure after every commit when content-relevant inputs change.
  // Runs before paint so the first frame reflects the clamped height when
  // possible (avoiding a blank-space flash at the start of the open animation).
  useLayoutEffect(() => {
    if (!mounted || isClosing || !hasSnap) return;
    if (isDragging || isSnapping) return;
    measureContent();
  }, [mounted, isClosing, hasSnap, isDragging, isSnapping, children, snapHeightsPx, viewportHeight, measureContent]);

  // Observe each direct child of the sheet so async size changes (images
  // loading, external CSS, fonts swapping, data streaming in) trigger a
  // fresh measurement even when React didn't render. A MutationObserver
  // picks up newly-added children (e.g., conditional lists) and re-observes.
  useEffect(() => {
    if (!mounted || !hasSnap) return;
    const sheet = sheetRef.current;
    if (!sheet || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureContent());
    const observed = new WeakSet<Element>();
    const observeAll = () => {
      for (let i = 0; i < sheet.children.length; i++) {
        const child = sheet.children[i];
        if (!observed.has(child)) {
          ro.observe(child);
          observed.add(child);
        }
      }
    };
    observeAll();
    const mo = new MutationObserver(() => {
      observeAll();
      measureContent();
    });
    mo.observe(sheet, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [mounted, hasSnap, measureContent]);

  // When `effectiveSnapHeightsPx` changes while the sheet is open (content
  // grew or shrank post-mount), re-clamp the currently-occupied snap to its
  // new effective height. No animation — this is a layout adjustment, not
  // a user-initiated snap. No `onSnap` fires — the snap index is unchanged.
  //
  // Gated on `sheetHeightPxRef.current > 0` so the effect does NOT interfere
  // with the initial open animation (which needs the height to animate from
  // 0 to target; see the open/close useEffect below). Once the sheet is
  // "at" a snap, this is the only path that re-clamps for content changes.
  useLayoutEffect(() => {
    if (!hasSnap || !effectiveSnapHeightsPx || !mounted || isClosing || !isOpen) return;
    if (isDragging || isSnapping) return;
    if (sheetHeightPxRef.current <= 0.5) return;
    const idx = Math.min(currentSnapIndexRef.current, effectiveSnapHeightsPx.length - 1);
    const newHeight = effectiveSnapHeightsPx[idx];
    if (Math.abs(newHeight - sheetHeightPxRef.current) < 0.5) return;
    setDisableTransition(true);
    sheetHeightPxRef.current = newHeight;
    setSheetHeightPx(newHeight);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDisableTransition(false));
    });
    return () => cancelAnimationFrame(raf);
  }, [effectiveSnapHeightsPx, hasSnap, mounted, isClosing, isOpen, isDragging, isSnapping]);

  // -----------------------------------------------------------------------
  // Shared snap-settle helper
  //
  // Attaches a one-shot `transitionend` listener that clears `isSnapping` and
  // fires `onSnap` exactly once the height transition completes. Used by both
  // the drag-release path and the imperative `snapTo` path so the two stay in
  // lockstep (same propertyName gating, same onSnap firing semantics).
  // -----------------------------------------------------------------------
  const settleAndFireSnap = useCallback((finalIndex: number) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onTransitionDone = (e: TransitionEvent) => {
      if (e.target !== sheet) return;
      if (e.propertyName !== 'height') return;
      sheet.removeEventListener('transitionend', onTransitionDone);
      setIsSnapping(false);
      onSnapRef.current?.(finalIndex, sortedSnaps![finalIndex]);
    };
    sheet.addEventListener('transitionend', onTransitionDone);
  }, [sortedSnaps]);

  // -----------------------------------------------------------------------
  // Imperative API: ref.current.snapTo(index, opts?)
  // -----------------------------------------------------------------------
  useImperativeHandle(ref, () => ({
    snapTo(index: number, opts?: { animate?: boolean }) {
      // Safe no-op conditions
      if (!hasSnap || !snapHeightsPx || !sortedSnaps) return;
      if (!mounted || isClosing) return;

      // Resolve against effective heights so the target respects the
      // content ceiling; if effective hasn't measured yet, fall back to
      // raw snaps (rare — only happens if snapTo is called before the
      // first layout pass).
      const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;

      const maxIdx = eff.length - 1;
      const requestedIdx = Math.max(0, Math.min(maxIdx, index));
      const targetHeight = eff[requestedIdx];
      // Settled index = lowest snap whose effective height equals the
      // clamped target — collapsed snaps normalize to a single index so
      // `onSnap` reports the position actually occupied.
      const finalIndex = resolveSettledIdx(targetHeight, eff);

      // No-op when the target already matches what's on screen to avoid a
      // zero-delta `transitionend` that would leak `isSnapping=true`.
      if (
        finalIndex === currentSnapIndexRef.current &&
        Math.abs(sheetHeightPxRef.current - targetHeight) < 0.5
      ) {
        return;
      }

      const animate = opts?.animate !== false;
      // If caller asked to animate but the height delta is zero (caller
      // requested a collapsed snap whose effective height matches current),
      // no `transitionend` will arrive — force the instant path so `onSnap`
      // fires synchronously and `isSnapping` never leaks.
      const heightUnchanged = Math.abs(sheetHeightPxRef.current - targetHeight) < 0.5;

      currentSnapIndexRef.current = finalIndex;
      setCurrentSnapIndex(finalIndex);
      sheetHeightPxRef.current = targetHeight;

      if (animate && !heightUnchanged) {
        setIsSnapping(true);
        setSheetHeightPx(targetHeight);
        settleAndFireSnap(finalIndex);
      } else {
        // Instant jump (caller asked for it, or height was already at target
        // and only the index changed): force `transition: none` for this
        // height change, fire `onSnap` synchronously (no transitionend will
        // arrive), then restore the transition on the next frame so
        // subsequent snaps animate again.
        setDisableTransition(true);
        setSheetHeightPx(targetHeight);
        onSnapRef.current?.(finalIndex, sortedSnaps[finalIndex]);
        // Double-rAF ensures the no-transition render has committed before we
        // flip transitions back on.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setDisableTransition(false);
          });
        });
      }
    },
  }), [hasSnap, snapHeightsPx, sortedSnaps, mounted, isClosing, settleAndFireSnap]);

  // Escape
  useEffect(() => {
    if (!mounted || isClosing) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mounted, isClosing, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (mounted && !isClosing) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mounted, isClosing]);

  // Reset translate on open (non-snap mode uses translate for enter)
  useEffect(() => {
    if (isOpen) {
      setTranslateY(0);
      translateYRef.current = 0;
      isDragAllowed.current = false;
      lastScrollTime.current = 0;
      setIsSnapping(false);
    }
  }, [isOpen]);

  // Track scroll activity for scroll-aware swipe
  useEffect(() => {
    if (swipeTarget !== 'sheet' || !mounted || isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const handleScroll = () => { lastScrollTime.current = Date.now(); };
    sheet.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => sheet.removeEventListener('scroll', handleScroll, { capture: true });
  }, [mounted, isClosing, swipeTarget]);

  /** Decide whether a touch gesture should drag the sheet or let the inner
   *  content scroll natively. Direction-aware so the user can pull the sheet
   *  to a higher snap, scroll content when at the top snap, scroll up content
   *  that's been scrolled, and pull the sheet down to dismiss when at the
   *  scroll origin — all from the same gesture-start point.
   *
   *  `direction` is the user's finger direction: `'up'` (diff < 0, fingers
   *  rising) or `'down'` (diff > 0, fingers falling). */
  const decideGestureIntent = useCallback(
    (target: EventTarget | null, direction: 'up' | 'down'): 'drag' | 'scroll' => {
      if (translateYRef.current > 0) return 'drag';
      if (swipeTarget === 'header') return 'drag';
      if (Date.now() - lastScrollTime.current < SCROLL_LOCK_TIMEOUT) return 'scroll';

      // Walk up looking for the first scrollable ancestor inside the sheet.
      let element = target as HTMLElement | null;
      let scroller: HTMLElement | null = null;
      while (element && element !== sheetRef.current) {
        if (element.scrollHeight > element.clientHeight + 0.5) {
          scroller = element;
          break;
        }
        element = element.parentElement;
      }

      if (direction === 'down') {
        // Finger moving down → content scrolls up. Scroll wins iff the
        // scrollable has somewhere above to reveal; otherwise pull the sheet
        // (toward dismiss, in non-snap mode; toward a lower snap otherwise).
        if (scroller && scroller.scrollTop > 0) return 'scroll';
        return 'drag';
      }

      // direction === 'up' → content scrolls down. Scroll wins iff the
      // scrollable has more below AND, in snap mode, the sheet has already
      // expanded to its tallest effective snap (so there's no more sheet
      // growth to consume the gesture).
      if (!scroller) return 'drag';
      const moreBelow =
        scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 0.5;
      if (!moreBelow) return 'drag';
      if (hasSnap) {
        const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
        if (!eff || eff.length === 0) return 'scroll';
        const maxH = eff[eff.length - 1];
        if (sheetHeightPxRef.current >= maxH - 0.5) return 'scroll';
        return 'drag';
      }
      return 'scroll';
    },
    [swipeTarget, hasSnap, snapHeightsPx],
  );

  /** True between touchstart and the first touchmove that crosses
   *  INTENT_THRESHOLD — during this window we have no direction and so haven't
   *  yet decided whether the gesture drags the sheet or scrolls inner content. */
  const isDragPending = useRef(false);

  // -----------------------------------------------------------------------
  // Touch event handlers
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mounted || isClosing) return;
    const target = swipeTarget === 'header'
      ? (headerElRef.current?.parentElement ?? sheetRef.current)
      : sheetRef.current;
    if (!target) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Skip drag init when the touch originates on the pill button so a tap
      // there stays a tap (and its click handler calls `snapTo(next)`).
      if (
        pillButtonRef.current &&
        e.target instanceof Node &&
        pillButtonRef.current.contains(e.target)
      ) {
        isDragAllowed.current = false;
        isDragPending.current = false;
        return;
      }
      // Re-measure synchronously so touchmove clamps against the current
      // content size. The ResizeObserver re-measure runs asynchronously, so
      // a touch immediately after a content swap (e.g. a tab change that
      // exposes much taller content) would otherwise drag against the old
      // effective max for one full gesture before settling correctly on
      // touchend.
      if (hasSnap) measureContent();

      const y = e.touches[0].clientY;
      dragStartY.current = y;
      dragStartTime.current = Date.now();
      dragStartHeightPx.current = sheetHeightPxRef.current;
      lastFrameY.current = y;
      lastFrameTime.current = Date.now();
      frameVelocity.current = 0;

      if (swipeTarget === 'header') {
        isDragAllowed.current = true;
        isDragPending.current = false;
        setIsDragging(true);
        setIsSnapping(false);
        return;
      }

      // Sheet mode: defer drag-vs-scroll decision to the first significant
      // touchmove so direction can be observed. Marking the gesture pending
      // (instead of committing isDragAllowed=true here) is what lets inner
      // scrollables receive native scroll: until intent is decided we do not
      // call preventDefault, so the browser can scroll on its own when the
      // gesture turns out to be a content scroll.
      isDragAllowed.current = false;
      isDragPending.current = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const diff = y - dragStartY.current;

      // Velocity tracking has to run before the pending-intent gate so a flick
      // gesture's initial frames still count toward release velocity.
      const now = Date.now();
      const dt = now - lastFrameTime.current;
      if (dt > 0) frameVelocity.current = (lastFrameY.current - y) / dt;
      lastFrameY.current = y;
      lastFrameTime.current = now;

      if (isDragPending.current) {
        if (Math.abs(diff) < INTENT_THRESHOLD) return;
        const intent = decideGestureIntent(e.target, diff < 0 ? 'up' : 'down');
        isDragPending.current = false;
        if (intent === 'scroll') {
          // Leave the touch to the browser. We never preventDefault on this
          // gesture, so the inner scrollable scrolls natively from here on.
          isDragAllowed.current = false;
          return;
        }
        isDragAllowed.current = true;
        setIsDragging(true);
        setIsSnapping(false);
      }

      if (!isDragAllowed.current) return;

      if (hasSnap) {
        // Clamp to the content-aware effective maximum — prevents dragging
        // the sheet taller than the content could naturally fill.
        const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
        if (!eff) return;
        const maxHeight = eff[eff.length - 1];
        const newHeight = Math.max(0, Math.min(maxHeight, dragStartHeightPx.current - diff));
        e.preventDefault();
        sheetHeightPxRef.current = newHeight;
        setSheetHeightPx(newHeight);
      } else {
        // Non-snap: only drag down to dismiss
        if (diff <= 0) return;
        e.preventDefault();
        translateYRef.current = diff;
        setTranslateY(diff);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      const v = frameVelocity.current; // px/ms, positive = flicking up

      // No-op when the gesture never committed to a drag (intent decided
      // "scroll", or finger never moved past INTENT_THRESHOLD). Without this,
      // a tap or content-scroll gesture would still fire a settle pass and
      // emit a spurious `onSnap` for a position that didn't change.
      if (!isDragAllowed.current) {
        isDragPending.current = false;
        return;
      }

      if (hasSnap) {
        const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
        if (!eff) {
          isDragAllowed.current = false;
          return;
        }
        const minHeight = eff[0];
        const currentH = sheetHeightPxRef.current;

        // Close if dragged well below lowest snap, or flicked down at/near it
        if (currentH < minHeight - DISMISS_THRESHOLD) {
          onCloseRef.current();
          isDragAllowed.current = false;
          return;
        }
        if (v < -FLICK_VELOCITY && currentH <= minHeight + DISMISS_OVERSHOOT) {
          onCloseRef.current();
          isDragAllowed.current = false;
          return;
        }

        // Pick target snap against effective heights so collapsed snaps
        // aren't selected as distinct targets. Nearest-snap ties prefer
        // the lowest index (from `<` comparison, not `<=`), keeping snap
        // reporting stable when heights collapse.
        let targetIndex: number;
        if (v > FLICK_VELOCITY) {
          // Flick up: first effective height strictly greater than current
          // drag position. If none (drag already at the content ceiling),
          // settle at the nearest effective — which, with a clamped drag,
          // is effectively "stay at the top visible snap".
          const idx = eff.findIndex(h => h > currentH + 0.5);
          if (idx !== -1) {
            targetIndex = idx;
          } else {
            let best = 0, bestDist = Infinity;
            for (let i = 0; i < eff.length; i++) {
              const d = Math.abs(eff[i] - currentH);
              if (d < bestDist) { bestDist = d; best = i; }
            }
            targetIndex = best;
          }
        } else if (v < -FLICK_VELOCITY) {
          // Flick down: largest effective height strictly less than current.
          let idx = -1;
          for (let i = eff.length - 1; i >= 0; i--) {
            if (eff[i] < currentH - 0.5) { idx = i; break; }
          }
          targetIndex = idx === -1 ? 0 : idx;
        } else {
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < eff.length; i++) {
            const d = Math.abs(eff[i] - currentH);
            if (d < bestDist) { bestDist = d; best = i; }
          }
          targetIndex = best;
        }

        const targetHeight = eff[targetIndex];
        // Canonicalize to the lowest equivalent index so `onSnap` reports
        // a single, stable position when snaps have collapsed.
        const finalIndex = resolveSettledIdx(targetHeight, eff);
        // If drag release lands on the exact height already on screen, no
        // transition will fire — take the instant path so `isSnapping` does
        // not leak and `onSnap` still fires.
        const heightUnchanged = Math.abs(sheetHeightPxRef.current - targetHeight) < 0.5;
        currentSnapIndexRef.current = finalIndex;
        setCurrentSnapIndex(finalIndex);
        sheetHeightPxRef.current = targetHeight;
        if (heightUnchanged) {
          setDisableTransition(true);
          setSheetHeightPx(targetHeight);
          onSnapRef.current?.(finalIndex, sortedSnaps![finalIndex]);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setDisableTransition(false));
          });
        } else {
          setIsSnapping(true);
          setSheetHeightPx(targetHeight);
          settleAndFireSnap(finalIndex);
        }
      } else {
        // Non-snap: drag-down to dismiss
        if (translateYRef.current > 0) {
          const duration = Date.now() - dragStartTime.current;
          const velocity = translateYRef.current / duration;
          if (translateYRef.current > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
            onCloseRef.current();
          } else {
            translateYRef.current = 0;
            setTranslateY(0);
          }
        }
      }

      isDragAllowed.current = false;
      isDragPending.current = false;
    };

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', handleTouchEnd, { passive: true });
    target.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
      target.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [mounted, isClosing, swipeTarget, decideGestureIntent, hasSnap, snapHeightsPx, sortedSnaps, settleAndFireSnap]);

  if (!mounted) return null;

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------
  // Use the effective max (content-clamped) as the denominator so opacity
  // still reaches its target (~0.4) when the sheet is at its tallest
  // *visible* position, not at an unreachable theoretical max.
  const effectiveMax = effectiveSnapHeightsPx && effectiveSnapHeightsPx.length > 0
    ? effectiveSnapHeightsPx[effectiveSnapHeightsPx.length - 1]
    : (snapHeightsPx ? snapHeightsPx[snapHeightsPx.length - 1] : 0);
  const backdropOpacity = isClosing
    ? undefined
    : hasSnap && snapHeightsPx
      ? Math.min(0.4, (sheetHeightPx / Math.max(1, effectiveMax)) * 0.4)
      : Math.max(0, 1 - translateY / 300);

  const rootStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex,
  };

  const backdropStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: hasSnap ? `rgba(0,0,0,${backdropOpacity ?? 0})` : 'var(--bs-backdrop, rgba(0,0,0,0.4))',
    ...(hasSnap
      ? {
          transition: isDragging ? 'none' : `background-color ${SNAP_SPRING_DURATION}ms ease`,
        }
      : isClosing
        ? { opacity: 0, transition: `opacity ${EXIT_DURATION}ms ease-out` }
        : { opacity: backdropOpacity, animation: 'tideui-fade-in 300ms ease-out' }),
  };

  // Sheet size + transitions differ by mode
  let sheetSizeAndMotion: CSSProperties;
  if (hasSnap) {
    const heightValue = isClosing ? '0px' : `${sheetHeightPx}px`;
    sheetSizeAndMotion = {
      height: heightValue,
      transition: isDragging || disableTransition
        ? 'none'
        : isClosing
          ? `height ${EXIT_DURATION}ms ease-out`
          : `height ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}`,
      touchAction: 'none',
    };
  } else {
    const nonSnapSize: CSSProperties = height
      ? heightIsMax ? { maxHeight: height } : { height }
      : {};
    let transitionStyle = '';
    if (!isDragging && !isClosing) {
      transitionStyle = isSnapping
        ? `transform ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}`
        : 'transform 300ms ease-out';
    }
    sheetSizeAndMotion = {
      ...nonSnapSize,
      ...(isClosing
        ? {
            transform: 'translateY(100%)',
            transition: `transform ${EXIT_DURATION}ms ease-out`,
          }
        : {
            ...(hasEntered ? {} : { animation: 'tideui-slide-up 300ms ease-out' }),
            transform: `translateY(${translateY}px)`,
            transition: transitionStyle || undefined,
          }),
    };
  }

  const sheetStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'var(--bs-bg, #ffffff)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
    overflow: 'hidden',
    ...sheetSizeAndMotion,
  };

  const handleWrapperStyle: CSSProperties = { flexShrink: 0, paddingTop: 8, paddingBottom: 4 };
  const handlePillStyle: CSSProperties = {
    width: 36,
    height: 4,
    backgroundColor: 'var(--bs-handle, #d1d5db)',
    borderRadius: 9999,
    margin: '0 auto',
  };
  // When snap points are configured, render the pill as a real button so a
  // tap/click advances the sheet to the next snap (and it's keyboard-focusable,
  // Enter/Space activates). Without snap points there's nothing to snap to, so
  // we keep the pill as a visual-only `<div>`.
  const handlePillButtonStyle: CSSProperties = {
    ...handlePillStyle,
    display: 'block',
    border: 'none',
    padding: 0,
    // Mobile Safari's UA stylesheet sets `min-height: 44px` on `<button>` for
    // accessibility — without overriding it the grabber pill renders as a
    // chunky 44px-tall block instead of the intended 4px hairline.
    minHeight: 0,
    background: handlePillStyle.backgroundColor,
    cursor: 'pointer',
  };
  const advanceSnap = () => {
    if (!hasSnap) return;
    const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
    if (!eff) return;
    // Skip to the next snap whose effective height is strictly larger than
    // the current one. When every higher snap has collapsed to the current
    // effective height (content fully visible at current snap), the tap is
    // a no-op — no visual twitch, no spurious onSnap.
    const fromIdx = currentSnapIndexRef.current;
    const next = nextDistinctIdx(fromIdx, eff);
    if (next === fromIdx) return;
    const targetHeight = eff[next];
    setIsSnapping(true);
    currentSnapIndexRef.current = next;
    setCurrentSnapIndex(next);
    sheetHeightPxRef.current = targetHeight;
    setSheetHeightPx(targetHeight);
    settleAndFireSnap(next);
  };
  const safeAreaStyle: CSSProperties = { flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom, 0px)' };

  return (
    <div style={rootStyle}>
      <div style={backdropStyle} onClick={onClose} />
      <div
        ref={sheetRef}
        className={className}
        style={sheetStyle}
        onAnimationEnd={handleAnimationEnd}
      >
        <div style={handleWrapperStyle}>
          {hasSnap ? (
            <button
              ref={pillButtonRef}
              type="button"
              aria-label="Expand sheet"
              onClick={advanceSnap}
              style={handlePillButtonStyle}
            />
          ) : (
            <div style={handlePillStyle} />
          )}
        </div>
        <HeaderRefContext.Provider value={setHeaderEl}>
          {children}
        </HeaderRefContext.Provider>
        <div style={safeAreaStyle} />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// BottomSheet.Header compound component
// ---------------------------------------------------------------------------

/** Wrap your header content in this to make it the drag target when swipeTarget="header" */
function Header({ children, className, style }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const setRef = useContext(HeaderRefContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRef?.(ref.current);
    return () => setRef?.(null);
  }, [setRef]);

  const headerStyle: CSSProperties = {
    flexShrink: 0,
    cursor: 'grab',
    touchAction: 'none',
    ...style,
  };

  return (
    <div ref={ref} className={className} style={headerStyle}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const BottomSheet = Object.assign(BottomSheetInner, { Header });
export default BottomSheet;
