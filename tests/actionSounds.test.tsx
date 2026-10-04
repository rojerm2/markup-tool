import { afterEach, expect, it, vi } from "vitest";
import {
  configureActionSounds,
  playActionSound,
  listenForControlSounds,
} from "../src/services/actionSounds";

afterEach(() => {
  configureActionSounds(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("stays silent when disabled, recognizes controls when enabled, and safely handles unavailable audio", () => {
  let clock = 100;
  vi.spyOn(performance, "now").mockImplementation(() => (clock += 100));
  const start = vi.fn(),
    ramp = vi.fn(),
    resume = vi.fn(() => Promise.reject(new Error("Audio blocked")));
  const Audio = vi.fn(function () {
    return {
      state: "suspended",
      currentTime: 0,
      destination: {},
      resume,
      createOscillator: () => ({
        frequency: { setValueAtTime() {} },
        connect() {},
        disconnect() {},
        start,
        stop() {},
      }),
      createGain: () => ({
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime: ramp,
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      }),
    };
  });
  vi.stubGlobal("AudioContext", Audio);
  playActionSound();
  expect(Audio).not.toHaveBeenCalled();
  const root = document.createElement("div");
  root.innerHTML =
    '<button>Zoom</button><button disabled>Undo</button><input type="number" value="10">';
  const stop = listenForControlSounds(root);
  configureActionSounds(true);
  root.querySelector("button")!.click();
  expect(start).toHaveBeenCalledOnce();
  root
    .querySelector("button[disabled]")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(start).toHaveBeenCalledOnce();
  const input = root.querySelector("input")!;
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  input.value = "18.5";
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  expect(start).toHaveBeenCalledTimes(2);
  const defaultGain = ramp.mock.calls.at(-1)![0];
  expect(defaultGain).toBeGreaterThan(0.035);
  configureActionSounds(true, 100);
  playActionSound();
  expect(ramp.mock.calls.at(-1)![0]).toBeGreaterThan(defaultGain);
  configureActionSounds(true, 25);
  playActionSound();
  expect(ramp.mock.calls.at(-1)![0]).toBeLessThan(defaultGain);
  configureActionSounds(true, 0);
  const count = start.mock.calls.length;
  playActionSound();
  expect(start).toHaveBeenCalledTimes(count);
  stop();
  root.querySelector("button")!.click();
  expect(start).toHaveBeenCalledTimes(count);
  configureActionSounds(false);
  playActionSound("markup");
  expect(start).toHaveBeenCalledTimes(count);
  vi.stubGlobal("AudioContext", undefined);
  configureActionSounds(true);
  expect(() => playActionSound()).not.toThrow();
});
