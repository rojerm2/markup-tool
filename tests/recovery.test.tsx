import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  RecoveryJournal,
  RECOVERY_DELAY,
  readRecovery,
} from "../src/services/recoveryService";
import { emptySession } from "../src/services/annotationSession";
import { parseProject } from "../src/services/projectFormat";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
const source = {
  reference: "C:/floor.pdf",
  filename: "floor.pdf",
  size: 100,
  sha256: "a".repeat(64),
  pages: 32,
};
const snapshot = {
  source,
  sourcePath: source.reference,
  projectPath: null,
  session: structuredClone(emptySession),
};
const journals: RecoveryJournal[] = [];

function journal(id: string | null = null) {
  const state = vi.fn();
  const value = new RecoveryJournal(id, state);
  journals.push(value);
  return { value, state };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset().mockResolvedValue("b".repeat(64));
});
afterEach(() => {
  journals.splice(0).forEach((j) => j.dispose());
  vi.useRealTimers();
});

it("debounces rapid edits and checkpoints validated metadata without PDF bytes", async () => {
  const { value, state } = journal();
  value.schedule(snapshot);
  await vi.advanceTimersByTimeAsync(1000);
  value.schedule({
    ...snapshot,
    session: {
      ...snapshot.session,
      legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
    },
  });
  await vi.advanceTimersByTimeAsync(RECOVERY_DELAY - 1);
  expect(invoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(invoke).toHaveBeenCalledTimes(1);
  const [command, args] = vi.mocked(invoke).mock.calls[0];
  expect(command).toBe("write_recovery");
  expect(Object.keys(args!).sort()).toEqual([
    "projectPath",
    "recoveryId",
    "sourcePath",
    "text",
  ]);
  expect(
    parseProject((args as { text: string }).text).session.legends[0].name,
  ).toBe("Walls");
  expect(state).toHaveBeenLastCalledWith("protected");
});

it("queues cleanup behind an in-flight checkpoint and cancels pending writes", async () => {
  const delayed = deferred<string>();
  vi.mocked(invoke).mockReturnValueOnce(delayed.promise);
  const { value, state } = journal();
  value.schedule(snapshot);
  const writing = value.flush();
  await Promise.resolve();
  value.schedule(snapshot);
  const cleaning = value.clear();
  delayed.resolve("b".repeat(64));
  await Promise.all([writing, cleaning]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual([
    "write_recovery",
    "delete_recovery",
  ]);
  expect(state.mock.calls.some(([s]) => s === "protected")).toBe(false);
  expect(state).toHaveBeenLastCalledWith("idle");
});

it("keeps new edits after Save and reuses a checkpoint identifier until cleanup", async () => {
  const { value } = journal("c".repeat(64));
  value.schedule(snapshot);
  await value.flush();
  expect(invoke).toHaveBeenCalledWith(
    "write_recovery",
    expect.objectContaining({ recoveryId: "c".repeat(64) }),
  );
  const cleanup = value.clear();
  value.schedule(snapshot);
  await cleanup;
  await vi.advanceTimersByTimeAsync(RECOVERY_DELAY);
  expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual([
    "write_recovery",
    "delete_recovery",
    "write_recovery",
  ]);
  expect(invoke).toHaveBeenLastCalledWith(
    "write_recovery",
    expect.objectContaining({ recoveryId: null }),
  );
});

it("reports disk failure and retries without marking changes protected", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  const { value, state } = journal();
  value.schedule(snapshot);
  await value.flush();
  expect(state).toHaveBeenLastCalledWith(
    "pending",
    expect.stringContaining("disk full"),
  );
  await vi.advanceTimersByTimeAsync(RECOVERY_DELAY * 2);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(state).toHaveBeenLastCalledWith("protected");
});

it("disposal keeps completed checkpoints and prevents scheduled work from running", async () => {
  const { value } = journal("c".repeat(64));
  value.schedule(snapshot);
  value.dispose();
  await vi.advanceTimersByTimeAsync(10000);
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects malformed recovered projects before exposing them to the viewer", async () => {
  vi.mocked(invoke).mockResolvedValue({
    sourcePath: "C:/cache.pdf",
    text: '{"format":"wrong"}',
  });
  await expect(readRecovery("b".repeat(64))).rejects.toThrow("Invalid project");
});
