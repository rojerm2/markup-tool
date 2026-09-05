import "./App.css";
import Toolbar from "./components/Toolbar/Toolbar";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import PdfViewer from "./components/PdfViewer/PdfViewer";

function App() {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const handleOpenPdf = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected) return;
      setPdfPath(selected);
      setRevision((value) => value + 1);
    } catch (err) {
      setError(`Could not open file picker: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="flex h-screen flex-col bg-gray-500 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-600 px-4 py-3">
        <h1 className="text-2xl font-bold text-amber-300">PDF Floor Plan Markup Tool</h1>
        <Toolbar onOpenPdf={handleOpenPdf} opening={opening} />
      </header>
      {error && <p role="alert" className="p-3 text-white bg-red-900">{error}</p>}
      {pdfPath && <p className="truncate px-4 py-1" title={pdfPath}>{pdfPath.split(/[\\/]/).pop()}</p>}
      <PdfViewer key={revision} file={pdfPath} />
    </main>
  );
}
export default App;
