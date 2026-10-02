import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import WidthControl from '../src/components/Annotations/WidthControl';

afterEach(cleanup);

it('previews the full thin-to-thick range and commits once on release', () => {
  const change = vi.fn();
  render(<WidthControl value={10} color="#facc15" onChange={change} />);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '0.25' } });
  expect((screen.getByLabelText('Highlight width') as HTMLInputElement).value).toBe('0.25');
  fireEvent.change(slider, { target: { value: '50' } });
  fireEvent.change(slider, { target: { value: '100' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  fireEvent.blur(slider);
  expect(change).toHaveBeenCalledExactlyOnceWith(100);
});

it('commits keyboard changes and cancels Escape and interrupted pointer gestures', () => {
  const change = vi.fn();
  render(<WidthControl value={10} color="#facc15" onChange={change} />);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '0.25' } });
  fireEvent.keyUp(slider, { key: 'Home' });
  expect(change).toHaveBeenCalledExactlyOnceWith(0.25);
  change.mockClear();
  for (const cancel of [() => fireEvent.keyDown(slider, { key: 'Escape' }), () => fireEvent.pointerCancel(slider)]) {
    fireEvent.change(slider, { target: { value: '100' } });
    cancel(); fireEvent.pointerUp(slider); fireEvent.blur(slider);
    expect(change).not.toHaveBeenCalled();
  }
});

it('accepts exact widths and rejects empty, invalid and out-of-range input', () => {
  const change = vi.fn();
  render(<WidthControl value={10} color="#facc15" onChange={change} />);
  const number = screen.getByLabelText('Highlight width');
  for (const value of ['', '0', '-1', '101']) fireEvent.change(number, { target: { value } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(number, { target: { value: '0.75' } });
  expect(change).toHaveBeenCalledExactlyOnceWith(0.75);
});
