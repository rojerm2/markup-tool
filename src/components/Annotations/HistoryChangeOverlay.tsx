import { pdfToViewport, type PageViewport } from '../../services/coordinates';
import type { ChangeRegion } from '../../services/historyFeedback';

export function changeViewportBounds(region: ChangeRegion, viewport: PageViewport) {
  const a = pdfToViewport({ x: region.x, y: region.y }, viewport), b = pdfToViewport({ x: region.x + region.width, y: region.y + region.height }, viewport);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
export default function HistoryChangeOverlay({ regions, viewport }: { regions: ChangeRegion[]; viewport: PageViewport }) {
  return <svg className="history-change-overlay" width={viewport.width} height={viewport.height} aria-hidden="true">
    {regions.map((region, index) => <rect key={index} {...changeViewportBounds(region, viewport)} rx={5} vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
