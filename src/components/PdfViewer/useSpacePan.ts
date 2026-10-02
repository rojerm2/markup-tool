import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { isEditingControl as isControl } from '../../services/annotationEditing';
import { isSpaceKey, supportsCanvasSpace } from '../../services/canvasFocus';

export function useSpacePan(host: RefObject<HTMLDivElement | null>, hand = false, revision: string | number = 0, disabled = false) {
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const held = useRef(false);
  const pointerControl = useRef<Element | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  function stop() {
    const id = drag.current?.id;
    drag.current = null;
    setDragging(false);
    if (id !== undefined && host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id);
  }

  useEffect(() => { held.current = false; setSpace(false); stop(); }, [hand, revision, disabled]);

  useEffect(() => {
    const reset = () => { held.current = false; setSpace(false); stop(); };
    const click = (event: MouseEvent) => {
      const root = host.current?.closest('.app-shell, .pdf-navigation');
      const control = event.target instanceof Element ? event.target.closest('button, summary, a, [role="button"]') : null;
      pointerControl.current = event.detail > 0 && control && root?.contains(control) && !isControl(control) ? control : null;
      // React's button action runs before this bubbling listener. Preserve
      // intentional focus changes (dialogs, property editors), but return
      // mouse-selected drawing controls to the canvas immediately.
      if (pointerControl.current && document.activeElement === control) {
        host.current?.focus({ preventScroll: true });
        pointerControl.current = null;
      }
    };
    const down = (event: KeyboardEvent) => {
      // Tab/Enter return to normal keyboard control activation. A mouse-selected
      // toolbar button must not require a second click on the PDF before panning.
      if (!isSpaceKey(event)) pointerControl.current = null;
      if (event.key === "Escape") { reset(); return; }
      const control = event.target instanceof Element ? event.target.closest('button, summary, a, [role="button"]') : null;
      if (control && control !== pointerControl.current) return;
      const numericControl = supportsCanvasSpace(event.target);
      if (disabled || event.defaultPrevented || !isSpaceKey(event) || (isControl(event.target) && !numericControl) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      // Move the shortcut's focus to the canvas before the browser can treat
      // Space as button activation. Subsequent gestures no longer depend on
      // remembering the last toolbar click (a completed drag also emits clicks).
      if (control || numericControl) {
        host.current?.focus({ preventScroll: true });
        pointerControl.current = null;
      }
      held.current = true;
      setSpace(true);
    };
    const up = (event: KeyboardEvent) => {
      if (isSpaceKey(event)) {
        if (held.current) event.preventDefault();
        reset();
      }
    };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("click", click);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("click", click);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      const id = drag.current?.id;
      if (id !== undefined && host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id);
    };
  }, [host, disabled]);

  return {
    className: dragging ? "is-panning" : (space || hand) ? "can-pan" : "",
    // Capture phase reserves the gesture before a future annotation layer sees it.
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (!disabled && event.button === 0 && !isControl(event.target)) host.current?.focus({ preventScroll: true });
      if (disabled || (!held.current && !hand) || event.button !== 0 || drag.current || isControl(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      setDragging(true);
    },
    onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
      const start = drag.current;
      if (!start || event.pointerId !== start.id) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
      event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
    },
    onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); stop();
    },
    onPointerCancel: stop,
    onLostPointerCapture: stop,
  };
}
