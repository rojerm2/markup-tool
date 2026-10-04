import { useEffect, useRef } from "react";
import type { RecentFile } from "../../services/recentFiles";

export default function RecentFilesMenu({
  files,
  disabled,
  onOpen,
  onClear,
}: {
  files: RecentFile[];
  disabled: boolean;
  onOpen: (file: RecentFile) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        ref.current &&
        event.target instanceof Node &&
        !ref.current.contains(event.target)
      )
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (disabled && ref.current) ref.current.open = false;
  }, [disabled]);
  return (
    <details ref={ref} className="recent-files">
      <summary
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        Recent files
      </summary>
      <div className="recent-popover">
        <div className="recent-heading">
          <strong>Recent files</strong>
          <button disabled={disabled || files.length === 0} onClick={onClear}>
            Clear list
          </button>
        </div>
        {files.length === 0 ? (
          <p>No recent files yet.</p>
        ) : (
          <ul>
            {files.map((file) => (
              <li key={file.path}>
                <button
                  className="recent-file"
                  disabled={disabled}
                  title={file.path}
                  onClick={() => {
                    if (ref.current) ref.current.open = false;
                    onOpen(file);
                  }}
                >
                  <strong>{file.filename}</strong>
                  <span className="recent-path">{file.path}</span>
                  <small>
                    {file.kind === "project" ? "Project" : "PDF"} · Last opened{" "}
                    <time dateTime={new Date(file.lastOpened).toISOString()}>
                      {new Date(file.lastOpened).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
