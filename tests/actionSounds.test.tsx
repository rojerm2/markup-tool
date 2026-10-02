import { afterEach, expect, it, vi } from 'vitest';
import { configureActionSounds, playActionSound, listenForControlSounds } from '../src/services/actionSounds';

afterEach(() => { configureActionSounds(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('stays silent when disabled, recognizes controls when enabled, and safely handles unavailable audio', () => {
  let clock = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => clock += 100);
  const start = vi.fn(), resume = vi.fn(() => Promise.reject(new Error('Audio blocked')));
  const Audio = vi.fn(function () {
    return { state: 'suspended', currentTime: 0, destination: {}, resume,
      createOscillator: () => ({ frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start, stop() {} }),
      createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }) };
  });
  vi.stubGlobal('AudioContext', Audio);
  playActionSound(); expect(Audio).not.toHaveBeenCalled();
  const root = document.createElement('div'); root.innerHTML = '<button>Zoom</button><button disabled>Undo</button><input type="number" value="10">';
  const stop = listenForControlSounds(root);
  configureActionSounds(true);
  root.querySelector('button')!.click(); expect(start).toHaveBeenCalledOnce();
  root.querySelector('button[disabled]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(start).toHaveBeenCalledOnce();
  const input = root.querySelector('input')!; input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  input.value = '18.5'; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); expect(start).toHaveBeenCalledTimes(2);
  stop(); root.querySelector('button')!.click(); expect(start).toHaveBeenCalledTimes(2);
  configureActionSounds(false); playActionSound('markup'); expect(start).toHaveBeenCalledTimes(2);
  vi.stubGlobal('AudioContext', undefined); configureActionSounds(true); expect(() => playActionSound()).not.toThrow();
});
