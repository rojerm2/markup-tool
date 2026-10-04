import { useEffect } from "react";
export type FileResult = {
  id: number;
  kind: "save" | "export" | "report";
  path: string;
};

export default function FileFeedback({
  result,
  dismiss,
}: {
  result: FileResult;
  dismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [result.id]);
  return (
    <div className={`file-feedback file-feedback-${result.kind}`} role="status">
      <span className="file-feedback-icon" aria-hidden="true">
        {result.kind === "save" ? "✓" : "↗"}
      </span>
      <div>
        <strong>
          {result.kind === "save"
            ? "Project saved"
            : result.kind === "report"
              ? "Report exported"
              : "PDF exported"}
        </strong>
        <span title={result.path}>{result.path.split(/[\\/]/).pop()}</span>
      </div>
      <button aria-label="Dismiss file confirmation" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
