import { invoke, isTauri } from "@tauri-apps/api/core";
export type RecentFile = {
  path: string;
  filename: string;
  kind: "pdf" | "project";
  lastOpened: number;
};

export async function listRecentFiles(): Promise<RecentFile[]> {
  return isTauri() ? invoke("list_recent_files") : [];
}

export async function rememberRecentFile(path: string): Promise<RecentFile[]> {
  return isTauri() ? invoke("remember_recent_file", { path }) : [];
}

export async function authorizeRecentFile(path: string): Promise<void> {
  if (isTauri()) await invoke("authorize_recent_file", { path });
}

export async function clearRecentFiles(): Promise<void> {
  if (isTauri()) await invoke("clear_recent_files");
}
