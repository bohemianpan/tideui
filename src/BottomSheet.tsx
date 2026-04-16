'use client';

import {
  useEffect,
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

// ---------------------------------------------------------------------------
// BottomSheet component
// ---------------------------------------------------------------------------

function BottomSheetInner({
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
}: BottomSheetProps) {
  useEffect(() => { injectStyles(); }, []);
  useEffect(() => {
    // Tracer to help confirm which build is loaded in production. Safe to remove later.
    // eslint-disable-next-line no-console
    console.log('[tideui] BottomSheet v0.1.0-snap-rewrite loaded');
  }, []);

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

  // Exit transitionend — wait for the property that's actually transitioning
  useEffect(() => {
    if (!isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const targetProp = hasSnap ? 'height' : 'transform';
    const onDone = (e: TransitionEvent) => {
      if (e.target !== sheet) return;
      if (e.propertyName !== targetProp) return;
      sheet.removeEventListener('transitionend', onDone);
      setMounted(false);
      setIsClosing(false);
    };
    sheet.addEventListener('transitionend', onDone);
    return () => sheet.removeEventListener('transitionend', onDone);
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
    if (isOpen) {
      const idx = Math.max(0, Math.min(defaultSnapPoint, snapHeightsPx.length - 1));
      currentSnapIndexRef.current = idx;
      setCurrentSnapIndex(idx);
      setSheetHeightPx(snapHeightsPx[idx]);
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerElRef = useRef<HTMLDivElement | null>(null);

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

  const shouldAllowDrag = useCallback((target: EventTarget | null): boolean => {
    if (translateYRef.current > 0) return true;
    if (swipeTarget === 'header') return true;
    if (Date.now() - lastScrollTime.current < SCROLL_LOCK_TIMEOUT) return false;

    let element = target as HTMLElement | null;
    while (element && element !== sheetRef.current) {
      if (element.scrollHeight > element.clientHeight && element.scrollTop > 0) {
        return false;
      }
      element = element.parentElement;
    }
    return true;
  }, [swipeTarget]);

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
      if (swipeTarget === 'sheet' && !shouldAllowDrag(e.target)) {
        isDragAllowed.current = false;
        return;
      }
      const y = e.touches[0].clientY;
      dragStartY.current = y;
      dragStartTime.current = Date.now();
      dragStartHeightPx.current = sheetHeightPxRef.current;
      lastFrameY.current = y;
      lastFrameTime.current = Date.now();
      frameVelocity.current = 0;
      isDragAllowed.current = swipeTarget === 'header' ? true : shouldAllowDrag(e.target);
      setIsDragging(true);
      setIsSnapping(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragAllowed.current) return;
      const y = e.touches[0].clientY;
      const diff = y - dragStartY.current;

      // Update per-frame velocity (for flick detection)
      const now = Date.now();
      const dt = now - lastFrameTime.current;
      if (dt > 0) frameVelocity.current = (lastFrameY.current - y) / dt;
      lastFrameY.current = y;
      lastFrameTime.current = now;

      if (hasSnap && snapHeightsPx) {
        const maxHeight = snapHeightsPx[snapHeightsPx.length - 1];
        const newHeight = Math.max(0, Math.min(maxHeight, dragStartHeightPx.current - diff));
        e.preventDefault();
        sheetHeightPxRef.current = newHeight;
        setSheetHeightPx(newHeight);
      } else {
        // Non-snap: only drag down to dismiss
        if (diff <= 0) return;
        if (!isDragAllowed.current && !shouldAllowDrag(e.target)) return;
        isDragAllowed.current = true;
        e.preventDefault();
        translateYRef.current = diff;
        setTranslateY(diff);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      const v = frameVelocity.current; // px/ms, positive = flicking up

      if (hasSnap && snapHeightsPx) {
        const minHeight = snapHeightsPx[0];
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

        // Pick target snap
        let targetIndex: number;
        if (v > FLICK_VELOCITY) {
          const idx = snapHeightsPx.findIndex(h => h > currentH + 1);
          targetIndex = idx === -1 ? snapHeightsPx.length - 1 : idx;
        } else if (v < -FLICK_VELOCITY) {
          const reversed = [...snapHeightsPx].reverse();
          const idx = reversed.findIndex(h => h < currentH - 1);
          targetIndex = idx === -1 ? 0 : snapHeightsPx.length - 1 - idx;
        } else {
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < snapHeightsPx.length; i++) {
            const d = Math.abs(snapHeightsPx[i] - currentH);
            if (d < bestDist) { bestDist = d; best = i; }
          }
          targetIndex = best;
        }

        const targetHeight = snapHeightsPx[targetIndex];
        const finalIndex = targetIndex;
        setIsSnapping(true);
        currentSnapIndexRef.current = finalIndex;
        setCurrentSnapIndex(finalIndex);
        sheetHeightPxRef.current = targetHeight;
        setSheetHeightPx(targetHeight);

        const sheet = sheetRef.current;
        if (sheet) {
          const onTransitionDone = (e: TransitionEvent) => {
            if (e.target !== sheet) return;
            if (e.propertyName !== 'height') return;
            sheet.removeEventListener('transitionend', onTransitionDone);
            setIsSnapping(false);
            onSnapRef.current?.(finalIndex, sortedSnaps![finalIndex]);
          };
          sheet.addEventListener('transitionend', onTransitionDone);
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
  }, [mounted, isClosing, swipeTarget, shouldAllowDrag, hasSnap, snapHeightsPx, sortedSnaps]);

  if (!mounted) return null;

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------
  const backdropOpacity = isClosing
    ? undefined
    : hasSnap && snapHeightsPx
      ? Math.min(0.4, (sheetHeightPx / snapHeightsPx[snapHeightsPx.length - 1]) * 0.4)
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
      transition: isDragging
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
          <div style={handlePillStyle} />
        </div>
        <HeaderRefContext.Provider value={setHeaderEl}>
          {children}
        </HeaderRefContext.Provider>
        <div style={safeAreaStyle} />
      </div>
    </div>
  );
}

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
