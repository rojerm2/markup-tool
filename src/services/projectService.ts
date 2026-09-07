import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
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
  const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_source_pdf', { path }));
  signal.throwIfAborted();
  const size = bytes.length;
  if (!size || size > 256 * 1024 * 1024) throw new Error('PDF must be between 1 byte and 256 MiB.');
  const sha256 = await hashBytes(bytes);
  signal.throwIfAborted();
  const pdf = await loadDocument(path, signal, bytes);
  if (pdf.numPages > 10000) throw new Error('PDF exceeds 10,000 pages.');
  // Fetch metadata in small batches; do not fan out 10,000 page requests at once.
  const pages = [];
  for (let start = 0; start < pdf.numPages; start += 16) {
    signal.throwIfAborted();
    pages.push(...await Promise.all(Array.from({ length: Math.min(16, pdf.numPages - start) }, (_, i) => pdf.getPage(start + i + 1))));
  }
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
