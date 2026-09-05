interface ToolbarProps {
  onOpenPdf: () => void;
  opening: boolean;
}

export default function Toolbar({ onOpenPdf, opening }: ToolbarProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onOpenPdf}
        disabled={opening}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        {opening ? "Opening…" : "Open PDF"}
      </button>
    </div>
  );
}
