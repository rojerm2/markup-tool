import type { RecoveryEntry } from "../../services/recoveryService";

export default function RecoveryPanel({
  entries,
  disabled,
  recover,
  dismiss,
}: {
  entries: RecoveryEntry[];
  disabled: boolean;
  recover: (entry: RecoveryEntry) => void;
  dismiss: (entry: RecoveryEntry) => void;
}) {
  if (!entries.length) return null;
  return (
    <details className="recovery-panel" open>
      <summary>Recover unsaved work ({entries.length})</summary>
      <p>Local checkpoints are available. Recover opens an editable copy.</p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>
              <strong>{entry.filename}</strong>
              <time dateTime={new Date(entry.updatedAt).toISOString()}>
                {new Date(entry.updatedAt).toLocaleString()}
              </time>
            </span>
            <button disabled={disabled} onClick={() => recover(entry)}>
              Recover {entry.filename}
            </button>
            <button
              disabled={disabled}
              title="Permanently remove this local checkpoint"
              onClick={() => dismiss(entry)}
            >
              Dismiss {entry.filename}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
