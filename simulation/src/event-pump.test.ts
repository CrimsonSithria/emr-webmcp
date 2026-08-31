import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EVENT_PUMP_DURATION_MS,
  EVENT_PUMP_INTERVAL_MS,
  bindProcessShutdown,
  runEventPump,
} from './event-pump.js';

describe('event pump defaults', () => {
  it('defaults to one synthetic event every two seconds for 15 minutes', () => {
    expect(EVENT_PUMP_INTERVAL_MS).toBe(2_000);
    expect(EVENT_PUMP_DURATION_MS).toBe(15 * 60 * 1_000);
    expect(EVENT_PUMP_DURATION_MS / EVENT_PUMP_INTERVAL_MS).toBe(450);
  });
});

describe('runEventPump', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits at t=0 and every interval until duration elapses', async () => {
    const emit = vi.fn(() => Promise.resolve());
    const running = runEventPump({
      intervalMs: EVENT_PUMP_INTERVAL_MS,
      durationMs: 10_000,
      emit,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await running;

    expect(result.emitted).toBe(5);
    expect(emit).toHaveBeenCalledTimes(5);
    expect(result.dryRun).toBe(false);
  });

  it('counts dry-run events without invoking the writer', async () => {
    const emit = vi.fn(() => Promise.resolve());
    const running = runEventPump({
      intervalMs: 2_000,
      durationMs: 8_000,
      dryRun: true,
      emit,
    });

    await vi.advanceTimersByTimeAsync(8_000);
    const result = await running;

    expect(result.emitted).toBe(4);
    expect(result.dryRun).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('stops immediately when the injected signal aborts', async () => {
    const controller = new AbortController();
    const emit = vi.fn(() => Promise.resolve());
    const running = runEventPump({
      intervalMs: 2_000,
      durationMs: 60_000,
      emit,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    controller.abort();
    const result = await running;

    expect(result.emitted).toBe(2);
    expect(result.stoppedBy).toBe('signal');
  });
});

describe('bindProcessShutdown', () => {
  it('aborts on SIGINT and SIGTERM and then unbinds', () => {
    const proc = new EventEmitter();
    const controller = new AbortController();
    const unbind = bindProcessShutdown(controller, proc);

    proc.emit('SIGINT');
    expect(controller.signal.aborted).toBe(true);

    const second = new AbortController();
    const unbindSecond = bindProcessShutdown(second, proc);
    unbindSecond();
    proc.emit('SIGTERM');
    expect(second.signal.aborted).toBe(false);

    unbind();
  });
});
