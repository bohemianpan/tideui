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
const VELOCITY_THRESHOLD = 0.4; // px/ms
const SCROLL_LOCK_TIMEOUT = 300;
const SNAP_SPRING_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SNAP_SPRING_DURATION = 400; // ms
const MOMENTUM_FACTOR = 200; // multiplied by velocity to project position
const EXIT_DURATION = 300; // ms

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
  // Inject keyframes on first render
  useEffect(() => { injectStyles(); }, []);

  // -----------------------------------------------------------------------
  // Mount / unmount state machine
  // -----------------------------------------------------------------------
  const [mounted, setMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(false); // entry animation done

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setIsClosing(false);
      setHasEntered(false);
    } else if (mounted) {
      // Begin exit animation
      setIsClosing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    // Only respond to animations on the sheet itself, not bubbled from children
    if (e.target !== e.currentTarget) return;
    if (!isClosing) {
      // Entry animation finished
      setHasEntered(true);
    }
  }, [isClosing]);

  // For exit: use transitionend on the sheet to detect when slide-out completes
  useEffect(() => {
    if (!isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onDone = (e: TransitionEvent) => {
      if (e.propertyName !== 'transform') return;
      sheet.removeEventListener('transitionend', onDone);
      setMounted(false);
      setIsClosing(false);
    };
    sheet.addEventListener('transitionend', onDone);
    return () => sheet.removeEventListener('transitionend', onDone);
  }, [isClosing]);

  // -----------------------------------------------------------------------
  // Snap points
  // -----------------------------------------------------------------------
  const hasSnap = snapPointsProp != null && snapPointsProp.length > 0;
  const sortedSnaps = useMemo(
    () => hasSnap ? [...snapPointsProp!].sort((a, b) => a - b) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasSnap, ...(snapPointsProp ?? [])],
  );

  // Current snap index for snap-point mode
  const [currentSnapIndex, setCurrentSnapIndex] = useState(defaultSnapPoint);
  const currentSnapIndexRef = useRef(defaultSnapPoint);

  // Reset snap index when sheet opens
  useEffect(() => {
    if (isOpen && hasSnap) {
      setCurrentSnapIndex(defaultSnapPoint);
      currentSnapIndexRef.current = defaultSnapPoint;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
  const translateYRef = useRef(0);
  const isDragAllowed = useRef(false);
  const lastScrollTime = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;

  // Callback for BottomSheet.Header to register its element
  const setHeaderEl = useCallback((el: HTMLDivElement | null) => {
    headerElRef.current = el;
  }, []);

  // Escape key
  useEffect(() => {
    if (!mounted || isClosing) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
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

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setTranslateY(0);
      translateYRef.current = 0;
      isDragAllowed.current = false;
      lastScrollTime.current = 0;
      setIsSnapping(false);
    }
  }, [isOpen]);

  // Track scroll activity (for scroll-aware swipe)
  useEffect(() => {
    if (swipeTarget !== 'sheet' || !mounted || isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const handleScroll = () => { lastScrollTime.current = Date.now(); };
    sheet.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => sheet.removeEventListener('scroll', handleScroll, { capture: true });
  }, [mounted, isClosing, swipeTarget]);

  // Check if dragging should be allowed
  const shouldAllowDrag = useCallback((target: EventTarget | null): boolean => {
    if (translateYRef.current > 0) return true;
    if (swipeTarget === 'header') return true;

    // Scroll lock: prevent drag right after scrolling
    if (Date.now() - lastScrollTime.current < SCROLL_LOCK_TIMEOUT) return false;

    // Check if content is scrolled
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
      dragStartY.current = e.touches[0].clientY;
      dragStartTime.current = Date.now();
      isDragAllowed.current = swipeTarget === 'header' ? true : shouldAllowDrag(e.target);
      setIsDragging(true);
      setIsSnapping(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragAllowed.current) return;
      const diff = e.touches[0].clientY - dragStartY.current;

      if (hasSnap) {
        // In snap mode, allow dragging in both directions (clamped to not go above top snap)
        const vh = window.innerHeight;
        const topSnap = sortedSnaps![sortedSnaps!.length - 1];
        const currentSnap = sortedSnaps![currentSnapIndexRef.current];
        // translateY = 0 means current snap position. Negative = dragging up, positive = dragging down.
        // Don't allow dragging above the highest snap point.
        const maxUpDrag = -(topSnap - currentSnap) * vh;
        const clampedDiff = Math.max(maxUpDrag, diff);
        e.preventDefault();
        translateYRef.current = clampedDiff;
        setTranslateY(clampedDiff);
      } else {
        // Original behavior: only allow dragging down
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

      if (hasSnap) {
        const vh = window.innerHeight;
        const currentSnap = sortedSnaps![currentSnapIndexRef.current];
        const currentSheetHeight = currentSnap * vh;
        const dragDistance = translateYRef.current; // positive = dragged down
        const duration = Date.now() - dragStartTime.current;
        const velocity = duration > 0 ? dragDistance / duration : 0; // px/ms, positive = downward

        // Actual sheet height after drag
        const actualHeight = currentSheetHeight - dragDistance;
        // Project with momentum
        const projectedHeight = actualHeight - velocity * MOMENTUM_FACTOR;

        // Check dismiss: if projected below screen (very small or negative height)
        const lowestSnap = sortedSnaps![0];
        const lowestSnapPx = lowestSnap * vh;
        if (projectedHeight < lowestSnapPx - DISMISS_THRESHOLD) {
          // Keep current translateY so exit transition starts from drag position
          onCloseRef.current();
          return;
        }

        // Find nearest snap point to projected height
        let bestIndex = 0;
        let bestDist = Infinity;
        for (let i = 0; i < sortedSnaps!.length; i++) {
          const snapPx = sortedSnaps![i] * vh;
          const dist = Math.abs(projectedHeight - snapPx);
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }

        // Snap directly: update height to new snap and reset translateY to 0
        // in one render. Height and transform transition together so the sheet
        // grows/shrinks into place instead of sliding first and jumping at the end.
        const finalBestIndex = bestIndex;
        setIsSnapping(true);
        currentSnapIndexRef.current = finalBestIndex;
        setCurrentSnapIndex(finalBestIndex);
        translateYRef.current = 0;
        setTranslateY(0);

        const sheet = sheetRef.current;
        if (sheet) {
          const onTransitionDone = (e: TransitionEvent) => {
            if (e.propertyName !== 'transform') return;
            sheet.removeEventListener('transitionend', onTransitionDone);
            setIsSnapping(false);
            onSnapRef.current?.(finalBestIndex, sortedSnaps![finalBestIndex]);
          };
          sheet.addEventListener('transitionend', onTransitionDone);
        }
      } else {
        // Original non-snap behavior
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
  }, [mounted, isClosing, swipeTarget, shouldAllowDrag, hasSnap, sortedSnaps]);

  // -----------------------------------------------------------------------
  // Render nothing when not mounted
  // -----------------------------------------------------------------------
  if (!mounted) return null;

  // -----------------------------------------------------------------------
  // Compute styles
  // -----------------------------------------------------------------------
  const backdropOpacity = isClosing
    ? undefined // handled by animation
    : Math.max(0, 1 - translateY / 300);

  // Sheet height in snap mode
  let snapHeightStyle: CSSProperties = {};
  if (hasSnap && !isClosing) {
    const snapFraction = sortedSnaps![currentSnapIndex];
    snapHeightStyle = { height: `${snapFraction * 100}vh` };
  }

  // Non-snap height
  const sizeStyle: CSSProperties = hasSnap
    ? snapHeightStyle
    : height
      ? heightIsMax ? { maxHeight: height } : { height }
      : {};

  // Transition for non-dragging states
  let transitionStyle = '';
  if (!isDragging && !isClosing) {
    if (isSnapping) {
      transitionStyle = `transform ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}, height ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}`;
    } else {
      transitionStyle = 'transform 300ms ease-out';
    }
  }

  // Root overlay styles
  const rootStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex,
  };

  // Backdrop styles
  const backdropStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'var(--bs-backdrop, rgba(0,0,0,0.4))',
    ...(isClosing
      ? {
          opacity: 0,
          transition: `opacity ${EXIT_DURATION}ms ease-out`,
        }
      : {
          opacity: backdropOpacity,
          animation: 'tideui-fade-in 300ms ease-out',
        }),
  };

  // Sheet container styles
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
    ...sizeStyle,
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

  // Drag handle wrapper styles
  const handleWrapperStyle: CSSProperties = {
    flexShrink: 0,
    paddingTop: 8,
    paddingBottom: 4,
  };

  // Drag handle pill styles
  const handlePillStyle: CSSProperties = {
    width: 36,
    height: 4,
    backgroundColor: 'var(--bs-handle, #d1d5db)',
    borderRadius: 9999,
    margin: '0 auto',
  };

  // Safe area padding
  const safeAreaStyle: CSSProperties = {
    flexShrink: 0,
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  };

  return (
    <div style={rootStyle}>
      {/* Backdrop */}
      <div
        style={backdropStyle}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={className}
        style={sheetStyle}
        onAnimationEnd={handleAnimationEnd}
      >
        {/* Drag handle */}
        <div style={handleWrapperStyle}>
          <div style={handlePillStyle} />
        </div>

        <HeaderRefContext.Provider value={setHeaderEl}>
          {children}
        </HeaderRefContext.Provider>

        {/* Safe area padding */}
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

const BottomSheet = Object.assign(BottomSheetInner, { Header });
export default BottomSheet;
