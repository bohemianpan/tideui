"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BottomSheet: () => BottomSheet_default
});
module.exports = __toCommonJS(index_exports);

// src/BottomSheet.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var DISMISS_THRESHOLD = 100;
var VELOCITY_THRESHOLD = 0.4;
var SCROLL_LOCK_TIMEOUT = 300;
var SNAP_SPRING_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
var SNAP_SPRING_DURATION = 300;
var EXIT_DURATION = 300;
var FLICK_VELOCITY = 0.3;
var DISMISS_OVERSHOOT = 60;
var INTENT_THRESHOLD = 5;
function resolveSettledIdx(targetHeight, effective) {
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] >= targetHeight - 0.5) return i;
  }
  return effective.length - 1;
}
function nextDistinctIdx(fromIdx, effective) {
  const current = effective[fromIdx];
  for (let i = fromIdx + 1; i < effective.length; i++) {
    if (effective[i] > current + 0.5) return i;
  }
  return fromIdx;
}
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
var HeaderRefContext = (0, import_react.createContext)(null);
var BottomSheetInner = (0, import_react.forwardRef)(function BottomSheetInner2({
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
}, ref) {
  (0, import_react.useEffect)(() => {
    injectStyles();
  }, []);
  const hasSnap = snapPointsProp != null && snapPointsProp.length > 0;
  const sortedSnaps = (0, import_react.useMemo)(
    () => hasSnap ? [...snapPointsProp].sort((a, b) => a - b) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasSnap, ...snapPointsProp ?? []]
  );
  const [viewportHeight, setViewportHeight] = (0, import_react.useState)(
    () => typeof window !== "undefined" ? window.innerHeight : 800
  );
  (0, import_react.useEffect)(() => {
    const update = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const snapHeightsPx = (0, import_react.useMemo)(
    () => hasSnap && sortedSnaps ? sortedSnaps.map((f) => f * viewportHeight) : null,
    [hasSnap, sortedSnaps, viewportHeight]
  );
  const [contentRequiredPx, setContentRequiredPx] = (0, import_react.useState)(null);
  const effectiveSnapHeightsPx = (0, import_react.useMemo)(() => {
    if (!snapHeightsPx) return null;
    if (contentRequiredPx == null || contentRequiredPx <= 0) return snapHeightsPx;
    return snapHeightsPx.map((h) => Math.min(h, contentRequiredPx));
  }, [snapHeightsPx, contentRequiredPx]);
  const effectiveSnapHeightsPxRef = (0, import_react.useRef)(null);
  effectiveSnapHeightsPxRef.current = effectiveSnapHeightsPx;
  const [mounted, setMounted] = (0, import_react.useState)(false);
  const [isClosing, setIsClosing] = (0, import_react.useState)(false);
  const [hasEntered, setHasEntered] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    if (isOpen) {
      setMounted(true);
      setIsClosing(false);
      setHasEntered(false);
    } else if (mounted) {
      setIsClosing(true);
    }
  }, [isOpen]);
  const handleAnimationEnd = (0, import_react.useCallback)((e) => {
    if (e.target !== e.currentTarget) return;
    if (!isClosing) setHasEntered(true);
  }, [isClosing]);
  (0, import_react.useEffect)(() => {
    if (!isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const targetProp = hasSnap ? "height" : "transform";
    const onDone = (e) => {
      if (e.target !== sheet) return;
      if (e.propertyName !== targetProp) return;
      sheet.removeEventListener("transitionend", onDone);
      setMounted(false);
      setIsClosing(false);
    };
    sheet.addEventListener("transitionend", onDone);
    return () => sheet.removeEventListener("transitionend", onDone);
  }, [isClosing, hasSnap]);
  const [currentSnapIndex, setCurrentSnapIndex] = (0, import_react.useState)(defaultSnapPoint);
  const currentSnapIndexRef = (0, import_react.useRef)(defaultSnapPoint);
  const [sheetHeightPx, setSheetHeightPx] = (0, import_react.useState)(0);
  const sheetHeightPxRef = (0, import_react.useRef)(0);
  sheetHeightPxRef.current = sheetHeightPx;
  (0, import_react.useEffect)(() => {
    if (!hasSnap || !snapHeightsPx) return;
    const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
    if (isOpen) {
      const rawIdx = Math.max(0, Math.min(defaultSnapPoint, eff.length - 1));
      const targetH = eff[rawIdx];
      const settled = resolveSettledIdx(targetH, eff);
      currentSnapIndexRef.current = settled;
      setCurrentSnapIndex(settled);
      sheetHeightPxRef.current = targetH;
      setSheetHeightPx(targetH);
    } else if (mounted) {
      setSheetHeightPx(0);
    }
  }, [isOpen, hasSnap, defaultSnapPoint, viewportHeight]);
  const [translateY, setTranslateY] = (0, import_react.useState)(0);
  const [isDragging, setIsDragging] = (0, import_react.useState)(false);
  const [isSnapping, setIsSnapping] = (0, import_react.useState)(false);
  const isDraggingRef = (0, import_react.useRef)(false);
  isDraggingRef.current = isDragging;
  const isSnappingRef = (0, import_react.useRef)(false);
  isSnappingRef.current = isSnapping;
  const [disableTransition, setDisableTransition] = (0, import_react.useState)(false);
  const sheetRef = (0, import_react.useRef)(null);
  const headerElRef = (0, import_react.useRef)(null);
  const pillButtonRef = (0, import_react.useRef)(null);
  const dragStartY = (0, import_react.useRef)(0);
  const dragStartTime = (0, import_react.useRef)(0);
  const dragStartHeightPx = (0, import_react.useRef)(0);
  const translateYRef = (0, import_react.useRef)(0);
  const isDragAllowed = (0, import_react.useRef)(false);
  const lastScrollTime = (0, import_react.useRef)(0);
  const lastFrameY = (0, import_react.useRef)(0);
  const lastFrameTime = (0, import_react.useRef)(0);
  const frameVelocity = (0, import_react.useRef)(0);
  const onCloseRef = (0, import_react.useRef)(onClose);
  onCloseRef.current = onClose;
  const onSnapRef = (0, import_react.useRef)(onSnap);
  onSnapRef.current = onSnap;
  const setHeaderEl = (0, import_react.useCallback)((el) => {
    headerElRef.current = el;
  }, []);
  const measureContent = (0, import_react.useCallback)(() => {
    if (!hasSnap) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (isDraggingRef.current || isSnappingRef.current) return;
    for (let i = 0; i < sheet.children.length; i++) {
      const child = sheet.children[i];
      const cs = getComputedStyle(child);
      if (parseFloat(cs.flexGrow || "0") > 0) {
        setContentRequiredPx((prev) => prev == null ? prev : null);
        return;
      }
    }
    const savedHeight = sheet.style.height;
    const savedTransition = sheet.style.transition;
    sheet.style.transition = "none";
    sheet.style.height = "auto";
    const natural = sheet.offsetHeight;
    sheet.style.height = savedHeight;
    sheet.style.transition = savedTransition;
    setContentRequiredPx(
      (prev) => prev != null && Math.abs(prev - natural) < 0.5 ? prev : natural
    );
  }, [hasSnap]);
  (0, import_react.useLayoutEffect)(() => {
    if (!mounted || isClosing || !hasSnap) return;
    if (isDragging || isSnapping) return;
    measureContent();
  }, [mounted, isClosing, hasSnap, isDragging, isSnapping, children, snapHeightsPx, viewportHeight, measureContent]);
  (0, import_react.useEffect)(() => {
    if (!mounted || !hasSnap) return;
    const sheet = sheetRef.current;
    if (!sheet || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureContent());
    const observed = /* @__PURE__ */ new WeakSet();
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
  (0, import_react.useLayoutEffect)(() => {
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
  const settleAndFireSnap = (0, import_react.useCallback)((finalIndex) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onTransitionDone = (e) => {
      if (e.target !== sheet) return;
      if (e.propertyName !== "height") return;
      sheet.removeEventListener("transitionend", onTransitionDone);
      setIsSnapping(false);
      onSnapRef.current?.(finalIndex, sortedSnaps[finalIndex]);
    };
    sheet.addEventListener("transitionend", onTransitionDone);
  }, [sortedSnaps]);
  (0, import_react.useImperativeHandle)(ref, () => ({
    snapTo(index, opts) {
      if (!hasSnap || !snapHeightsPx || !sortedSnaps) return;
      if (!mounted || isClosing) return;
      const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
      const maxIdx = eff.length - 1;
      const requestedIdx = Math.max(0, Math.min(maxIdx, index));
      const targetHeight = eff[requestedIdx];
      const finalIndex = resolveSettledIdx(targetHeight, eff);
      if (finalIndex === currentSnapIndexRef.current && Math.abs(sheetHeightPxRef.current - targetHeight) < 0.5) {
        return;
      }
      const animate = opts?.animate !== false;
      const heightUnchanged = Math.abs(sheetHeightPxRef.current - targetHeight) < 0.5;
      currentSnapIndexRef.current = finalIndex;
      setCurrentSnapIndex(finalIndex);
      sheetHeightPxRef.current = targetHeight;
      if (animate && !heightUnchanged) {
        setIsSnapping(true);
        setSheetHeightPx(targetHeight);
        settleAndFireSnap(finalIndex);
      } else {
        setDisableTransition(true);
        setSheetHeightPx(targetHeight);
        onSnapRef.current?.(finalIndex, sortedSnaps[finalIndex]);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setDisableTransition(false);
          });
        });
      }
    }
  }), [hasSnap, snapHeightsPx, sortedSnaps, mounted, isClosing, settleAndFireSnap]);
  (0, import_react.useEffect)(() => {
    if (!mounted || isClosing) return;
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [mounted, isClosing, onClose]);
  (0, import_react.useEffect)(() => {
    if (mounted && !isClosing) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mounted, isClosing]);
  (0, import_react.useEffect)(() => {
    if (isOpen) {
      setTranslateY(0);
      translateYRef.current = 0;
      isDragAllowed.current = false;
      lastScrollTime.current = 0;
      setIsSnapping(false);
    }
  }, [isOpen]);
  (0, import_react.useEffect)(() => {
    if (swipeTarget !== "sheet" || !mounted || isClosing) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const handleScroll = () => {
      lastScrollTime.current = Date.now();
    };
    sheet.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => sheet.removeEventListener("scroll", handleScroll, { capture: true });
  }, [mounted, isClosing, swipeTarget]);
  const decideGestureIntent = (0, import_react.useCallback)(
    (target, direction) => {
      if (translateYRef.current > 0) return "drag";
      if (swipeTarget === "header") return "drag";
      if (Date.now() - lastScrollTime.current < SCROLL_LOCK_TIMEOUT) return "scroll";
      let element = target;
      let scroller = null;
      while (element && element !== sheetRef.current) {
        if (element.scrollHeight > element.clientHeight + 0.5) {
          scroller = element;
          break;
        }
        element = element.parentElement;
      }
      if (direction === "down") {
        if (scroller && scroller.scrollTop > 0) return "scroll";
        return "drag";
      }
      if (!scroller) return "drag";
      const moreBelow = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 0.5;
      if (!moreBelow) return "drag";
      if (hasSnap) {
        const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
        if (!eff || eff.length === 0) return "scroll";
        const maxH = eff[eff.length - 1];
        if (sheetHeightPxRef.current >= maxH - 0.5) return "scroll";
        return "drag";
      }
      return "scroll";
    },
    [swipeTarget, hasSnap, snapHeightsPx]
  );
  const isDragPending = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => {
    if (!mounted || isClosing) return;
    const target = swipeTarget === "header" ? headerElRef.current?.parentElement ?? sheetRef.current : sheetRef.current;
    if (!target) return;
    const handleTouchStart = (e) => {
      if (pillButtonRef.current && e.target instanceof Node && pillButtonRef.current.contains(e.target)) {
        isDragAllowed.current = false;
        isDragPending.current = false;
        return;
      }
      const y = e.touches[0].clientY;
      dragStartY.current = y;
      dragStartTime.current = Date.now();
      dragStartHeightPx.current = sheetHeightPxRef.current;
      lastFrameY.current = y;
      lastFrameTime.current = Date.now();
      frameVelocity.current = 0;
      if (swipeTarget === "header") {
        isDragAllowed.current = true;
        isDragPending.current = false;
        setIsDragging(true);
        setIsSnapping(false);
        return;
      }
      isDragAllowed.current = false;
      isDragPending.current = true;
    };
    const handleTouchMove = (e) => {
      const y = e.touches[0].clientY;
      const diff = y - dragStartY.current;
      const now = Date.now();
      const dt = now - lastFrameTime.current;
      if (dt > 0) frameVelocity.current = (lastFrameY.current - y) / dt;
      lastFrameY.current = y;
      lastFrameTime.current = now;
      if (isDragPending.current) {
        if (Math.abs(diff) < INTENT_THRESHOLD) return;
        const intent = decideGestureIntent(e.target, diff < 0 ? "up" : "down");
        isDragPending.current = false;
        if (intent === "scroll") {
          isDragAllowed.current = false;
          return;
        }
        isDragAllowed.current = true;
        setIsDragging(true);
        setIsSnapping(false);
      }
      if (!isDragAllowed.current) return;
      if (hasSnap) {
        const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
        if (!eff) return;
        const maxHeight = eff[eff.length - 1];
        const newHeight = Math.max(0, Math.min(maxHeight, dragStartHeightPx.current - diff));
        e.preventDefault();
        sheetHeightPxRef.current = newHeight;
        setSheetHeightPx(newHeight);
      } else {
        if (diff <= 0) return;
        e.preventDefault();
        translateYRef.current = diff;
        setTranslateY(diff);
      }
    };
    const handleTouchEnd = () => {
      setIsDragging(false);
      const v = frameVelocity.current;
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
        let targetIndex;
        if (v > FLICK_VELOCITY) {
          const idx = eff.findIndex((h) => h > currentH + 0.5);
          if (idx !== -1) {
            targetIndex = idx;
          } else {
            let best = 0, bestDist = Infinity;
            for (let i = 0; i < eff.length; i++) {
              const d = Math.abs(eff[i] - currentH);
              if (d < bestDist) {
                bestDist = d;
                best = i;
              }
            }
            targetIndex = best;
          }
        } else if (v < -FLICK_VELOCITY) {
          let idx = -1;
          for (let i = eff.length - 1; i >= 0; i--) {
            if (eff[i] < currentH - 0.5) {
              idx = i;
              break;
            }
          }
          targetIndex = idx === -1 ? 0 : idx;
        } else {
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < eff.length; i++) {
            const d = Math.abs(eff[i] - currentH);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          targetIndex = best;
        }
        const targetHeight = eff[targetIndex];
        const finalIndex = resolveSettledIdx(targetHeight, eff);
        const heightUnchanged = Math.abs(sheetHeightPxRef.current - targetHeight) < 0.5;
        currentSnapIndexRef.current = finalIndex;
        setCurrentSnapIndex(finalIndex);
        sheetHeightPxRef.current = targetHeight;
        if (heightUnchanged) {
          setDisableTransition(true);
          setSheetHeightPx(targetHeight);
          onSnapRef.current?.(finalIndex, sortedSnaps[finalIndex]);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setDisableTransition(false));
          });
        } else {
          setIsSnapping(true);
          setSheetHeightPx(targetHeight);
          settleAndFireSnap(finalIndex);
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
      isDragPending.current = false;
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
  }, [mounted, isClosing, swipeTarget, decideGestureIntent, hasSnap, snapHeightsPx, sortedSnaps, settleAndFireSnap]);
  if (!mounted) return null;
  const effectiveMax = effectiveSnapHeightsPx && effectiveSnapHeightsPx.length > 0 ? effectiveSnapHeightsPx[effectiveSnapHeightsPx.length - 1] : snapHeightsPx ? snapHeightsPx[snapHeightsPx.length - 1] : 0;
  const backdropOpacity = isClosing ? void 0 : hasSnap && snapHeightsPx ? Math.min(0.4, sheetHeightPx / Math.max(1, effectiveMax) * 0.4) : Math.max(0, 1 - translateY / 300);
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
    backgroundColor: hasSnap ? `rgba(0,0,0,${backdropOpacity ?? 0})` : "var(--bs-backdrop, rgba(0,0,0,0.4))",
    ...hasSnap ? {
      transition: isDragging ? "none" : `background-color ${SNAP_SPRING_DURATION}ms ease`
    } : isClosing ? { opacity: 0, transition: `opacity ${EXIT_DURATION}ms ease-out` } : { opacity: backdropOpacity, animation: "tideui-fade-in 300ms ease-out" }
  };
  let sheetSizeAndMotion;
  if (hasSnap) {
    const heightValue = isClosing ? "0px" : `${sheetHeightPx}px`;
    sheetSizeAndMotion = {
      height: heightValue,
      transition: isDragging || disableTransition ? "none" : isClosing ? `height ${EXIT_DURATION}ms ease-out` : `height ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}`,
      touchAction: "none"
    };
  } else {
    const nonSnapSize = height ? heightIsMax ? { maxHeight: height } : { height } : {};
    let transitionStyle = "";
    if (!isDragging && !isClosing) {
      transitionStyle = isSnapping ? `transform ${SNAP_SPRING_DURATION}ms ${SNAP_SPRING_EASING}` : "transform 300ms ease-out";
    }
    sheetSizeAndMotion = {
      ...nonSnapSize,
      ...isClosing ? {
        transform: "translateY(100%)",
        transition: `transform ${EXIT_DURATION}ms ease-out`
      } : {
        ...hasEntered ? {} : { animation: "tideui-slide-up 300ms ease-out" },
        transform: `translateY(${translateY}px)`,
        transition: transitionStyle || void 0
      }
    };
  }
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
    overflow: "hidden",
    ...sheetSizeAndMotion
  };
  const handleWrapperStyle = { flexShrink: 0, paddingTop: 8, paddingBottom: 4 };
  const handlePillStyle = {
    width: 36,
    height: 4,
    backgroundColor: "var(--bs-handle, #d1d5db)",
    borderRadius: 9999,
    margin: "0 auto"
  };
  const handlePillButtonStyle = {
    ...handlePillStyle,
    display: "block",
    border: "none",
    padding: 0,
    // Mobile Safari's UA stylesheet sets `min-height: 44px` on `<button>` for
    // accessibility — without overriding it the grabber pill renders as a
    // chunky 44px-tall block instead of the intended 4px hairline.
    minHeight: 0,
    background: handlePillStyle.backgroundColor,
    cursor: "pointer"
  };
  const advanceSnap = () => {
    if (!hasSnap) return;
    const eff = effectiveSnapHeightsPxRef.current ?? snapHeightsPx;
    if (!eff) return;
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
  const safeAreaStyle = { flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: rootStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: backdropStyle, onClick: onClose }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        ref: sheetRef,
        className,
        style: sheetStyle,
        onAnimationEnd: handleAnimationEnd,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: handleWrapperStyle, children: hasSnap ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              ref: pillButtonRef,
              type: "button",
              "aria-label": "Expand sheet",
              onClick: advanceSnap,
              style: handlePillButtonStyle
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: handlePillStyle }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeaderRefContext.Provider, { value: setHeaderEl, children }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: safeAreaStyle })
        ]
      }
    )
  ] });
});
function Header({ children, className, style }) {
  const setRef = (0, import_react.useContext)(HeaderRefContext);
  const ref = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    setRef?.(ref.current);
    return () => setRef?.(null);
  }, [setRef]);
  const headerStyle = {
    flexShrink: 0,
    cursor: "grab",
    touchAction: "none",
    ...style
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref, className, style: headerStyle, children });
}
var BottomSheet = Object.assign(BottomSheetInner, { Header });
var BottomSheet_default = BottomSheet;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BottomSheet
});
//# sourceMappingURL=index.js.map