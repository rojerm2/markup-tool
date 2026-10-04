import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  parseProject,
  serializeProject,
  type SourceIdentity,
} from "./projectFormat";
import type { AnnotationSession } from "./annotationSession";

export type RecoveryEntry = {
  id: string;
  filename: string;
  updatedAt: number;
};
export const RECOVERY_DELAY = 1500;
export type RecoveryState = "pending" | "writing" | "protected" | "idle";
type Snapshot = {
  sourcePath: string;
  projectPath: string | null;
  source: SourceIdentity;
  session: AnnotationSession;
};

export async function listRecovery(): Promise<RecoveryEntry[]> {
  return isTauri() ? invoke("list_recovery") : [];
}

export async function readRecovery(id: string) {
  const result = await invoke<{ text: string; sourcePath: string }>(
    "read_recovery",
    { id },
  );
  return { sourcePath: result.sourcePath, project: parseProject(result.text) };
}

export async function deleteRecovery(id: string) {
  await invoke("delete_recovery", { id });
}

/** One journal per document. Writes and cleanup share a queue so a slow
 * checkpoint cannot recreate a recovery record after Save or Discard. */
export class RecoveryJournal {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Snapshot | null = null;
  private tail: Promise<void> = Promise.resolve();
  private revision = 0;
  private disposed = false;
  private retryDelay = RECOVERY_DELAY;
  constructor(
    private id: string | null,
    private state: (state: RecoveryState, error?: string) => void,
    private enabled = isTauri(),
  ) {}

  schedule(snapshot: Snapshot) {
    if (!this.enabled || this.disposed) return;
    this.pending = snapshot;
    ++this.revision;
    clearTimeout(this.timer);
    this.state("pending");
    this.timer = setTimeout(() => void this.flush(), RECOVERY_DELAY);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    const snapshot = this.pending;
    if (!snapshot) return this.tail;
    this.pending = null;
    const revision = this.revision;
    this.tail = this.tail.then(async () => {
      if (!this.disposed && revision === this.revision) this.state("writing");
      try {
        this.id = await invoke<string>("write_recovery", {
          sourcePath: snapshot.sourcePath,
          projectPath: snapshot.projectPath,
          recoveryId: this.id,
          text: serializeProject(snapshot.source, snapshot.session),
        });
        this.retryDelay = RECOVERY_DELAY;
        if (!this.disposed && revision === this.revision)
          this.state("protected");
      } catch (error) {
        if (!this.disposed && revision === this.revision) {
          this.state("pending", `Recovery checkpoint failed: ${String(error)}`);
          this.pending = snapshot;
          this.retryDelay = Math.min(30000, this.retryDelay * 2);
          this.timer = setTimeout(() => void this.flush(), this.retryDelay);
        }
      }
    });
    return this.tail;
  }

  clear(): Promise<void> {
    clearTimeout(this.timer);
    this.pending = null;
    const revision = ++this.revision;
    this.tail = this.tail.then(async () => {
      try {
        if (this.id) await deleteRecovery(this.id);
        this.id = null;
        if (!this.disposed && revision === this.revision) this.state("idle");
      } catch (error) {
        if (!this.disposed && revision === this.revision)
          this.state("pending", `Recovery cleanup failed: ${String(error)}`);
      }
    });
    return this.tail;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.pending = null;
  }
}
