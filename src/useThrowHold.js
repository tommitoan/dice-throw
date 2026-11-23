import { useRef, useState } from 'react';

// One hold, two surfaces: the roll button and the cup standing in the yard. Holding charges the
// throw from TAP_STRENGTH up across HOLD_MS and the charge is visible; the release is the only
// throw — the click a browser fires right after a pointer release is swallowed, while a click with
// no pointer underneath it (Enter, Space, a screen reader) throws at TAP_STRENGTH.
export const HOLD_MS = 1800;
export const TAP_STRENGTH = 0.78;
const MIN_STRENGTH = 0.7;
// The engine clamps `strength` (0.65 - 1.45), so the charge stops at 1.4: what the bar shows is
// always a number the throw will actually get.
const MAX_STRENGTH = 1.4;
const STRENGTH_SPAN = MAX_STRENGTH - MIN_STRENGTH;
const RELEASE_WINDOW_MS = 600;

export default function useThrowHold(onRoll, { disabled = false } = {}) {
  const hold = useRef(null);
  const rolledAt = useRef(0);
  const [progress, setProgress] = useState(0);

  const clear = () => {
    if (hold.current?.timer) clearInterval(hold.current.timer);
    hold.current = null;
    setProgress(0);
  };

  const start = (event) => {
    if (disabled || hold.current) return;
    // Pointer capture keeps the release on this surface even if the pointer drifts off it.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    const at = performance.now();
    hold.current = { at, timer: setInterval(() => setProgress(Math.min(1, (performance.now() - at) / HOLD_MS)), 80) };
    setProgress(0);
  };

  const release = () => {
    const held = hold.current;
    if (!held) return null;
    const elapsed = Math.max(0, performance.now() - held.at);
    clear();
    rolledAt.current = Date.now();
    return MIN_STRENGTH + (Math.min(HOLD_MS, elapsed) / HOLD_MS) * STRENGTH_SPAN;
  };

  const handlers = {
    onPointerDown: (event) => { if (!disabled) start(event); },
    onPointerUp: () => {
      if (disabled) return;
      const strength = release();
      if (strength != null) onRoll(strength);
    },
    onPointerCancel: () => clear(),
    onContextMenu: (event) => event.preventDefault(),
    onClick: () => {
      if (hold.current) clear(); // a press that never saw its release: close it out, then roll
      if (disabled) return;
      if (Date.now() - rolledAt.current < RELEASE_WINDOW_MS) return; // the release above already threw
      onRoll(TAP_STRENGTH);
    },
    // An SVG surface does not turn Enter/Space into a click the way a real button does.
    onKeyDown: (event) => {
      if (disabled || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      handlers.onClick();
    },
  };

  const progressStrength = MIN_STRENGTH + progress * STRENGTH_SPAN;
  return { progress, strength: progress > 0 ? progressStrength : TAP_STRENGTH, handlers };
}
