import {afterEach,expect,it,vi} from 'vitest';
import {readLargerControls,writeLargerControls} from '../src/services/uiPreferences';
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
it.each([null,'false','TRUE','{}','1','undefined'])('defaults safely for stored %s',value=>{
  if(value!==null)localStorage.setItem('pdf-markup.larger-controls',value);
  expect(readLargerControls()).toBe(false);
});
it('persists both sizes',()=>{
  writeLargerControls(true);expect(readLargerControls()).toBe(true);
  writeLargerControls(false);expect(readLargerControls()).toBe(false);
});
it('tolerates unavailable storage',()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  expect(readLargerControls()).toBe(false);expect(()=>writeLargerControls(true)).not.toThrow();
});
