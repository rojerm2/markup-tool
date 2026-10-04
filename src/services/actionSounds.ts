type Sound = "control" | "markup" | "undo" | "redo" | "success" | "error";
let enabled = false,
  volume = 60,
  context: AudioContext | undefined,
  lastPlayed = -Infinity;

export function configureActionSounds(value: boolean, level = 60): void {
  enabled = value;
  volume = Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 60;
}

// Quiet synthesized cues require no assets, network, or microphone access.
export function playActionSound(kind: Sound = "control"): void {
  if (!enabled || volume === 0 || typeof window.AudioContext !== "function")
    return;
  const now = performance.now();
  if (now - lastPlayed < 65) return;
  lastPlayed = now;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
    const frequencies = {
      control: 520,
      markup: 660,
      undo: 330,
      redo: 440,
      success: 780,
      error: 220,
    };
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      time = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequencies[kind], time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.18 * (volume / 100) ** 2, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.075);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(time);
    oscillator.stop(time + 0.08);
  } catch {
    /* Unsupported or unavailable audio must never interrupt an action. */
  }
}

export function listenForControlSounds(root: HTMLElement): () => void {
  const initialValues = new WeakMap<HTMLInputElement, string>();
  const click = (event: MouseEvent) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("button, summary")
        : null;
    if (
      button &&
      !button.hasAttribute("disabled") &&
      !button.closest("[data-own-feedback]")
    )
      playActionSound();
  };
  const change = (event: Event) => {
    if (
      event.target instanceof HTMLSelectElement ||
      (event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox")
    )
      playActionSound();
  };
  const release = (event: PointerEvent) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === "range"
    )
      playActionSound();
  };
  const focus = (event: FocusEvent) => {
    if (event.target instanceof HTMLInputElement)
      initialValues.set(event.target, event.target.value);
  };
  const blur = (event: FocusEvent) => {
    const input = event.target;
    if (
      input instanceof HTMLInputElement &&
      (input.type === "number" ||
        input.hasAttribute("data-canvas-space-pan")) &&
      initialValues.get(input) !== input.value
    )
      playActionSound();
  };
  const key = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === "range" &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    )
      playActionSound();
  };
  root.addEventListener("click", click);
  root.addEventListener("change", change);
  root.addEventListener("pointerup", release);
  root.addEventListener("focusin", focus);
  root.addEventListener("focusout", blur);
  root.addEventListener("keyup", key);
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("change", change);
    root.removeEventListener("pointerup", release);
    root.removeEventListener("focusin", focus);
    root.removeEventListener("focusout", blur);
    root.removeEventListener("keyup", key);
  };
}
