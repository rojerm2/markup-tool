import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { exportPdf, generateInWorker } from '../src/services/exportService';
import { emptySession } from '../src/services/annotationSession';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-dialog',()=>({save:vi.fn()}));
const source={reference:'C:/source.pdf',filename:'source.pdf',sha256:'a'.repeat(64),size:10,pages:1};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
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
 expect(invoke).toHaveBeenLastCalledWith('write_export',expect.objectContaining({path:'C:/marked.pdf',projectPath:'C:/work.pmarkup',bytes:[37,80,68,70],sha256:source.sha256}));expect(terminate).toHaveBeenCalledOnce();
});
