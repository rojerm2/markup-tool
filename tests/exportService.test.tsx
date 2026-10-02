import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { exportPdf, printPdf, generateInWorker } from '../src/services/exportService';
import { emptySession } from '../src/services/annotationSession';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-dialog',()=>({save:vi.fn()}));
const source={reference:'C:/source.pdf',filename:'source.pdf',sha256:'a'.repeat(64),size:10,pages:1};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
it('prints captured annotated bytes without a save dialog and keeps the source identity',async()=>{
 const terminate=vi.fn();vi.stubGlobal('Worker',class {onmessage:((event:unknown)=>void)|null=null;onerror=null;terminate=terminate;postMessage(){queueMicrotask(()=>this.onmessage?.({data:{bytes:new Uint8Array([37,80,68,70])}}));}});
 vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array([1,2]).buffer).mockResolvedValueOnce(undefined);
 await printPdf(source.reference,source,emptySession,new AbortController().signal);
 expect(save).not.toHaveBeenCalled();expect(invoke).toHaveBeenLastCalledWith('print_annotated_pdf',new Uint8Array([37,80,68,70]),{headers:{'x-print-metadata':JSON.stringify({sourcePath:source.reference,size:10,sha256:source.sha256,filename:source.filename})}});
 expect(terminate).toHaveBeenCalledOnce();
});
it('native save cancellation does not read or generate output',async()=>{
 vi.mocked(save).mockResolvedValue(null);expect(await exportPdf(source.reference,null,source,emptySession,new AbortController().signal)).toBeNull();expect(invoke).not.toHaveBeenCalled();
 expect(save).toHaveBeenCalledWith(expect.objectContaining({defaultPath:'source_Marked.pdf'}));
});
it('source identity read failure stops before worker/write',async()=>{
 vi.mocked(save).mockResolvedValue('C:/marked.pdf');vi.mocked(invoke).mockRejectedValue(new Error('SHA-256 mismatch'));
 await expect(exportPdf(source.reference,null,source,emptySession,new AbortController().signal)).rejects.toThrow('SHA-256');
 expect(invoke).toHaveBeenCalledOnce();expect(invoke).toHaveBeenCalledWith('read_export_source',{sourcePath:source.reference,size:10,sha256:source.sha256});
});
it('worker cancellation terminates resources and prevents late completion',async()=>{
 let instance!: {onmessage: ((event:unknown)=>void)|null; terminate: ReturnType<typeof vi.fn>};
 vi.stubGlobal('Worker',class {onmessage=null;onerror=null;terminate=vi.fn();postMessage=vi.fn();constructor(){instance=this;}});
 const controller=new AbortController();const result=generateInWorker(new Uint8Array([1]),emptySession,controller.signal);
 controller.abort();await expect(result).rejects.toThrow('Export cancelled');expect(instance.terminate).toHaveBeenCalledOnce();
});
it('successful worker writes captured bytes/identity/project and releases worker',async()=>{
 const terminate=vi.fn();vi.stubGlobal('Worker',class {onmessage:((event:unknown)=>void)|null=null;onerror=null;terminate=terminate;postMessage(){queueMicrotask(()=>this.onmessage?.({data:{bytes:new Uint8Array([37,80,68,70])}}));}});
 vi.mocked(save).mockResolvedValue('C:/marked.pdf');vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array([1,2]).buffer).mockResolvedValueOnce(undefined);
 expect(await exportPdf(source.reference,'C:/work.pmarkup',source,emptySession,new AbortController().signal)).toBe('C:/marked.pdf');
 expect(invoke).toHaveBeenLastCalledWith('write_export',new Uint8Array([37,80,68,70]),expect.objectContaining({headers:{'x-export-metadata':JSON.stringify({sourcePath:source.reference,size:10,sha256:source.sha256,path:'C:/marked.pdf',projectPath:'C:/work.pmarkup'})}}));expect(terminate).toHaveBeenCalledOnce();
});

it('reports worker progress without terminating it and preserves Unicode paths in binary export metadata',async()=>{
 const progress=vi.fn(), terminate=vi.fn();
 vi.stubGlobal('Worker',class {onmessage:((event:unknown)=>void)|null=null;onerror=null;terminate=terminate;postMessage(){queueMicrotask(()=>{this.onmessage?.({data:{progress:'Preparing pages…'}});expect(terminate).not.toHaveBeenCalled();this.onmessage?.({data:{bytes:new Uint8Array([37,80,68,70])}});});}});
 vi.mocked(save).mockResolvedValue('C:/图纸/plan😀.pdf');vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array([1,2]).buffer).mockResolvedValueOnce(undefined);
 await exportPdf('C:/图纸/original.pdf',null,source,emptySession,new AbortController().signal,progress);
 const call=vi.mocked(invoke).mock.calls.at(-1)!;
 expect(call[1]).toBeInstanceOf(Uint8Array);
 const metadata=(call[2]?.headers as Record<string,string>)['x-export-metadata'];
 expect(metadata).toMatch(/^[\x20-\x7e]+$/);
 expect(JSON.parse(metadata)).toMatchObject({path:'C:/图纸/plan😀.pdf',sourcePath:'C:/图纸/original.pdf'});
 expect(progress.mock.calls.flat()).toEqual(['Reading PDF…','Preparing pages…','Saving PDF…']);
 expect(terminate).toHaveBeenCalledOnce();
});
