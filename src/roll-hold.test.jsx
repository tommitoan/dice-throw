// @vitest-environment jsdom
// The hold-to-throw button: how strength is decided, and that one press is one throw.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RollHoldButton from './RollHoldButton.jsx';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const renderButton = (props = {}) => {
  const onRoll = vi.fn();
  render(<RollHoldButton onRoll={onRoll} {...props}><span>Hold to throw</span></RollHoldButton>);
  return { onRoll, button: screen.getByRole('button') };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('hold to throw', () => {
  it('rolls at tap strength for a plain click: keyboard, screen reader, or a press with no pointer', () => {
    const { onRoll, button } = renderButton();
    fireEvent.click(button);
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(onRoll).toHaveBeenCalledWith(0.78);
  });

  it('rolls once for a pointer press, and the click that follows the release is not a second throw', () => {
    const { onRoll, button } = renderButton();
    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onRoll).toHaveBeenCalledTimes(1);
    const [strength] = onRoll.mock.calls[0];
    expect(strength).toBeGreaterThanOrEqual(0.7);
    expect(strength).toBeLessThan(0.8);
    fireEvent.click(button); // the browser fires this after every release
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it('rolls once even when the press never saw its release', () => {
    const { onRoll, button } = renderButton();
    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.click(button); // pointer lost, or a synthetic press
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it('does not roll while disabled', () => {
    const { onRoll, button } = renderButton({ disabled: true });
    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.click(button);
    expect(onRoll).not.toHaveBeenCalled();
  });

  it('measures a held press: the bar shows progress and the strength climbs with it', async () => {
    const { onRoll, button } = renderButton();
    const bar = button.querySelector('.roll-hold-bar');
    expect(bar).toBeTruthy();
    fireEvent.pointerDown(button, { pointerId: 1 });
    await sleep(250); // real time: the bar counts wall clock
    expect(Number(bar.style.getPropertyValue('--hold'))).toBeGreaterThan(0);
    expect(bar.classList.contains('is-holding')).toBe(true);
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onRoll).toHaveBeenCalledTimes(1);
    const [strength] = onRoll.mock.calls[0];
    expect(strength).toBeGreaterThan(0.78); // a tap is 0.78; a held press throws harder
  });
});
