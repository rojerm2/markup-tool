import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

function isControl(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("dialog, input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

export function useSpacePan(host: RefObject<HTMLDivElement | null>) {
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const held = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  function stop() {
    const id = drag.current?.id;
    drag.current = null;
    setDragging(false);
    if (id !== undefined && host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id);
  }

  useEffect(() => {
    const reset = () => { held.current = false; setSpace(false); stop(); };
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isControl(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      held.current = true;
      setSpace(true);
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") reset(); };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      const id = drag.current?.id;
      if (id !== undefined && host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id);
    };
  }, [host]);

  return {
    className: dragging ? "is-panning" : space ? "can-pan" : "",
    // Capture phase reserves the gesture before a future annotation layer sees it.
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (!held.current || event.button !== 0 || drag.current || isControl(event.target)) return;
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
