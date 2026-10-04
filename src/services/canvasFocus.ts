export function focusCanvas(control: Element | null): void {
  control
    ?.closest(".app-shell, .pdf-navigation")
    ?.querySelector<HTMLElement>(".pdf-scroll")
    ?.focus({ preventScroll: true });
}

export function supportsCanvasSpace(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement &&
    !!target.closest(".pdf-navigation") &&
    !target.closest('dialog, [role="dialog"], [role="alertdialog"]') &&
    (target.type === "range" ||
      target.type === "number" ||
      target.hasAttribute("data-canvas-space-pan"))
  );
}

export function isSpaceKey(
  event: Pick<KeyboardEvent, "key" | "code">,
): boolean {
  return (
    event.code === "Space" || event.key === " " || event.key === "Spacebar"
  );
}
