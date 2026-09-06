import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { loadDocument } from './pdfService';
import { hashBytes, MAX_PROJECT_BYTES, parseProject, type SourceIdentity } from './projectFormat';

export const projectFilters = [{ name: 'Editable markup project (*.pmarkup)', extensions: ['pmarkup'] }];
export async function choosePdf(title = 'Open PDF') {
  return open({ title, multiple: false, filters: [{ name: 'Source PDF', extensions: ['pdf'] }] });
}
export async function readProject() {
  const path = await open({ title: 'Open editable project', multiple: false, filters: projectFilters });
  if (!path) return null;
  const text = await invoke<string>('read_project', { path });
  if (text.length > MAX_PROJECT_BYTES) throw new Error('Project exceeds 16 MiB.');
  return { path, project: parseProject(text) };
}
export async function loadSource(path: string, signal: AbortSignal) {
  const bytes = await readFile(path);
  signal.throwIfAborted();
  const size = bytes.length;
  if (!size || size > 1024 * 1024 * 1024) throw new Error('PDF must be between 1 byte and 1 GiB.');
  const sha256 = await hashBytes(bytes);
  signal.throwIfAborted();
  const pdf = await loadDocument(path, signal, bytes);
  if (pdf.numPages > 10000) throw new Error('PDF exceeds 10,000 pages.');
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
  signal.throwIfAborted();
  const source: SourceIdentity = { reference: path, filename: path.split(/[\\/]/).pop()!, size, sha256, pages: pdf.numPages };
  return { pages, source };
}
export async function resolveSource(projectPath: string, reference: string) {
  // Native resolution only accepts an already user-authorized file. JSON cannot grant scope.
  return invoke<string | null>('resolve_source', { projectPath, reference });
}
export async function writeProject(path: string | null, sourcePath: string, text: string) {
  const destination = path ?? await save({ title: 'Save editable project', defaultPath: 'Untitled.pmarkup', filters: projectFilters });
  if (!destination) return null;
  await invoke('write_project', { path: destination, sourcePath, text });
  return destination;
}
