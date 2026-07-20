interface ToolbarProps {
  onOpenPdf: () => void;
}

export default function Toolbar({ onOpenPdf }: ToolbarProps) {
  return (
    <header className="flex items-center gap-3 border-b bg-white p-3 shadow-sm">
      <button
        onClick={onOpenPdf}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Open PDF
      </button>
    </header>
  );
}
