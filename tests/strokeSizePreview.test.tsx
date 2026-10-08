import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import StrokeSizePreview from "../src/components/Annotations/StrokeSizePreview";
import type { PageViewport } from "../src/services/coordinates";

afterEach(cleanup);

it.each([0.5, 1, 4])(
  "shrinks the dashed outline with the actual stroke down to 0.25 pt at zoom %s",
  (scale) => {
    const viewport = {
      width: 600 * scale,
      height: 800 * scale,
      convertToViewportPoint: (x: number, y: number) => [x * scale, y * scale],
    } as unknown as PageViewport;
    const { rerender } = render(
      <StrokeSizePreview width={8} color="#facc15" viewport={viewport} />,
    );
    const radii = () =>
      [...screen.getByRole("img").querySelectorAll("circle")].map((c) =>
        Number(c.getAttribute("r")),
      );
    expect(radii()).toEqual([4 * scale, 4 * scale]);
    for (const width of [4, 1, 0.25]) {
      rerender(
        <StrokeSizePreview width={width} color="#38bdf8" viewport={viewport} />,
      );
      expect(radii()).toEqual([(width * scale) / 2, (width * scale) / 2]);
      const circles = screen.getByRole("img").querySelectorAll("circle");
      expect(circles[0].getAttribute("fill")).toBe("#38bdf8");
      expect(
        Number(circles[1].getAttribute("stroke-width")),
      ).toBeLessThanOrEqual((width * scale) / 4);
      expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
        `Highlighter preview: ${width} pt`,
      );
    }
  },
);
