import type { DrawingStyle } from "../components/Annotations/DrawingControls";

export function showStrokePreview(
  target: EventTarget | null,
  style: Pick<DrawingStyle, "width" | "color">,
) {
  if (target instanceof Element)
    target
      .closest(".pdf-navigation")
      ?.dispatchEvent(new CustomEvent("stroke-preview", { detail: style }));
}
