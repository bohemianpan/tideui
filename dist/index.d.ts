import * as react from 'react';
import { ReactNode, CSSProperties } from 'react';
import * as react_jsx_runtime from 'react/jsx-runtime';

interface BottomSheetProps {
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
interface BottomSheetHandle {
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
    snapTo(index: number, opts?: {
        animate?: boolean;
    }): void;
}
/** Wrap your header content in this to make it the drag target when swipeTarget="header" */
declare function Header({ children, className, style }: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}): react_jsx_runtime.JSX.Element;
declare const BottomSheet: react.ForwardRefExoticComponent<BottomSheetProps & react.RefAttributes<BottomSheetHandle>> & {
    Header: typeof Header;
};

export { BottomSheet, type BottomSheetHandle, type BottomSheetProps };
