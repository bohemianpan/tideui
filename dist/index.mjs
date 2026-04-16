// src/BottomSheet.tsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  createContext,
  useContext
} from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var DISMISS_THRESHOLD = 100;
var VELOCITY_THRESHOLD = 0.4;
var SCROLL_LOCK_TIMEOUT = 300;
var SNAP_SPRING_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
var SNAP_SPRING_DURATION = 400;
var MOMENTUM_FACTOR = 200;
var EXIT_DURATION = 300;
var STYLE_ID = "tideui-bottomsheet";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
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
var HeaderRefContext = createContext(null);
function BottomSheetInner({
  isOpen,
  onClose,
  children,
  height,
  heightIsMax = false,
  swipeTarget = "sheet",
  className,
  zIndex = 2e3,
  snapPoints: snapPointsProp,
  defaultSnapPoint = 0,
  onSnap
}) {
  useEffect(() => {
    injectStyles();
  }, []);
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
  }, [isOpen]);
  const handleAnimationEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!isClosing) {
      setHasEntered(true);
    }
  }, [isClosing]);
  useEffect(() => {
    if (!isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onDone = (e) => {
      if (e.propertyName !== "transform") return;
      sheet.removeEventListener("transitionend", onDone);
      setMounted(false);
      setIsClosing(false);
    };
    sheet.addEventListener("transitionend", onDone);
    return () => sheet.removeEventListener("transitionend", onDone);
  }, [isClosing]);
  const hasSnap = snapPointsProp != null && snapPointsProp.length > 0;
  const sortedSnaps = useMemo(
    () => hasSnap ? [...snapPointsProp].sort((a, b) => a - b) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasSnap, ...snapPointsProp ?? []]
  );
  const [currentSnapIndex, setCurrentSnapIndex] = useState(defaultSnapPoint);
  const currentSnapIndexRef = useRef(defaultSnapPoint);
  useEffect(() => {
    if (isOpen && hasSnap) {
      setCurrentSnapIndex(defaultSnapPoint);
      currentSnapIndexRef.current = defaultSnapPoint;
    }
  }, [isOpen]);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);
  const sheetRef = useRef(null);
  const headerElRef = useRef(null);
  const dragStartY = useRef(0);
  const dragStartTime = useRef(0);
  const translateYRef = useRef(0);
  const isDragAllowed = useRef(false);
  const lastScrollTime = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;
  const setHeaderEl = useCallback((el) => {
    headerElRef.current = el;
  }, []);
  useEffect(() => {
    if (!mounted || isClosing) return;
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [mounted, isClosing, onClose]);
  useEffect(() => {
    if (mounted && !isClosing) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mounted, isClosing]);
  useEffect(() => {
    if (isOpen) {
      setTranslateY(0);
      translateYRef.current = 0;
      isDragAllowed.current = false;
      lastScrollTime.current = 0;
      setIsSnapping(false);
    }
  }, [isOpen]);
  useEffect(() => {
    if (swipeTarget !== "sheet" || !mounted || isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const handleScroll = () => {
      lastScrollTime.current = Date.now();
    };
    sheet.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => sheet.removeEventListener("scroll", handleScroll, { capture: true });
  }, [mounted, isClosing, swipeTarget]);
  const shouldAllowDrag = useCallback((target) => {
    if (translateYRef.current > 0) return true;
    if (swipeTarget === "header") return true;
    if (Date.now() - lastScrollTime.current < SCROLL_LOCK_TIMEOUT) return false;
    let element = target;
    while (element && element !== sheetRef.current) {
      if (element.scrollHeight > element.clientHeight && element.scrollTop > 0) {
        return false;
      }
      element = element.parentElement;
    }
    return true;
  }, [swipeTarget]);
  useEffect(() => {
    if (!mounted || isClosing) return;
    const target = swipeTarget === "header" ? headerElRef.current?.parentElement ?? sheetRef.current : sheetRef.current;
    if (!target) return;
    const handleTouchStart = (e) => {
      if (swipeTarget === "sheet" && !shouldAllowDrag(e.target)) {
        isDragAllowed.current = false;
        return;
      }
      dragStartY.current = e.touches[0].clientY;
      dragStartTime.current = Date.now();
      isDragAllowed.current = swipeTarget === "header" ? true : shouldAllowDrag(e.target);
      setIsDragging(true);
      setIsSnapping(false);
    };
    const handleTouchMove = (e) => {
      if (!isDragAllowed.current) return;
      const diff = e.touches[0].clientY - dragStartY.current;
      if (hasSnap) {
        const vh = window.innerHeight;
        const topSnap = sortedSnaps[sortedSnaps.length - 1];
        const currentSnap = sortedSnaps[currentSnapIndexRef.current];
        const maxUpDrag = -(topSnap - currentSnap) * vh;
        const clampedDiff = Math.max(maxUpDrag, diff);
        e.preventDefault();
        translateYRef.current = clampedDiff;
        setTranslateY(clampedDiff);
      } else {
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
        const currentSnap = sortedSnaps[currentSnapIndexRef.current];
        const currentSheetHeight = currentSnap * vh;
        const dragDistance = translateYRef.current;
        const duration = Date.now() - dragStartTime.current;
        const velocity = duration > 0 ? dragDistance / duration : 0;
        const actualHeight = currentSheetHeight - dragDistance;
        const projectedHeight = actualHeight - velocity * MOMENTUM_FACTOR;
        const lowestSnap = sortedSnaps[0];
        const lowestSnapPx = lowestSnap * vh;
        if (projectedHeight < lowestSnapPx - DISMISS_THRESHOLD) {
          onCloseRef.current();
          return;
        }
        let bestIndex = 0;
        let bestDist = Infinity;
        for (let i = 0; i < sortedSnaps.length; i++) {
          const snapPx = sortedSnaps[i] * vh;
          const dist = Math.abs(projectedHeight - snapPx);
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }
        const finalBestIndex = bestIndex;
        setIsSnapping(true);
        currentSnapIndexRef.current = finalBestIndex;
        setCurrentSnapIndex(finalBestIndex);
        translateYRef.current = 0;
        setTranslateY(0);
        const sheet = sheetRef.current;
        if (sheet) {
          const onTransitionDone = (e) => {
            if (e.propertyName !== "transform") return;
            sheet.removeEventListener("transitionend", onTransitionDone);
            setIsSnapping(false);
            onSnapRef.current?.(finalBestIndex, sortedSnaps[finalBestIndex]);
          };
          sheet.addEventListener("transitionend", onTransitionDone);
        }
      } else {
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
    target.addEventListener("touchstart", handleTouchStart, { passive: true });
    target.addEventListener("touchmove", handleTouchMove, { passive: false });
    target.addEventListener("touchend", handleTouchEnd, { passive: true });
    target.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("touchend", handleTouchEnd);
      target.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [mounted, isClosing, swipeTarget, shouldAllowDrag, hasSnap, sortedSnaps]);
  if (!mounted) return null;
  const backdropOpacity = isClosing ? void 0 : Math.max(0, 1 - translateY / 300);
  let snapHeightStyle = {};
  if (hasSnap && !isClosing) {
    const snapFraction = sortedSnaps[currentSnapIndex];
    snapHeightStyle = { height: `${snapFraction * 100}vh` };
  }
  const sizeStyle = hasSnap ? snapHeightStyle : height ? heightIsMax ? { maxHeight: height } : { height } : {};
  let transitionStyle = "";
  if (!isDragging && !isClosing) {
    if (isSnapping) {
      transitionStyle = `transform ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}, height ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}`;
    } else {
      transitionStyle = "transform 300ms ease-out";
    }
  }
  const rootStyle = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex
  };
  const backdropStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "var(--bs-backdrop, rgba(0,0,0,0.4))",
    ...isClosing ? {
      opacity: 0,
      transition: `opacity ${EXIT_DURATION}ms ease-out`
    } : {
      opacity: backdropOpacity,
      animation: "tideui-fade-in 300ms ease-out"
    }
  };
  const sheetStyle = {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "var(--bs-bg, #ffffff)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 -10px 40px rgba(0,0,0,0.15)",
    ...sizeStyle,
    ...isClosing ? {
      transform: "translateY(100%)",
      transition: `transform ${EXIT_DURATION}ms ease-out`
    } : {
      ...hasEntered ? {} : { animation: "tideui-slide-up 300ms ease-out" },
      transform: `translateY(${translateY}px)`,
      transition: transitionStyle || void 0
    }
  };
  const handleWrapperStyle = {
    flexShrink: 0,
    paddingTop: 8,
    paddingBottom: 4
  };
  const handlePillStyle = {
    width: 36,
    height: 4,
    backgroundColor: "var(--bs-handle, #d1d5db)",
    borderRadius: 9999,
    margin: "0 auto"
  };
  const safeAreaStyle = {
    flexShrink: 0,
    paddingBottom: "env(safe-area-inset-bottom, 0px)"
  };
  return /* @__PURE__ */ jsxs("div", { style: rootStyle, children: [
    /* @__PURE__ */ jsx(
      "div",
      {
        style: backdropStyle,
        onClick: onClose
      }
    ),
    /* @__PURE__ */ jsxs(
      "div",
      {
        ref: sheetRef,
        className,
        style: sheetStyle,
        onAnimationEnd: handleAnimationEnd,
        children: [
          /* @__PURE__ */ jsx("div", { style: handleWrapperStyle, children: /* @__PURE__ */ jsx("div", { style: handlePillStyle }) }),
          /* @__PURE__ */ jsx(HeaderRefContext.Provider, { value: setHeaderEl, children }),
          /* @__PURE__ */ jsx("div", { style: safeAreaStyle })
        ]
      }
    )
  ] });
}
function Header({ children, className, style }) {
  const setRef = useContext(HeaderRefContext);
  const ref = useRef(null);
  useEffect(() => {
    setRef?.(ref.current);
    return () => setRef?.(null);
  }, [setRef]);
  const headerStyle = {
    flexShrink: 0,
    cursor: "grab",
    touchAction: "none",
    ...style
  };
  return /* @__PURE__ */ jsx("div", { ref, className, style: headerStyle, children });
}
var BottomSheet = Object.assign(BottomSheetInner, { Header });
var BottomSheet_default = BottomSheet;
export {
  BottomSheet_default as BottomSheet
};
//# sourceMappingURL=index.mjs.map