import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWorkerLoop } from '../../src/shared/runtime/worker-loop.js';

describe('startWorkerLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains queued work without idle delay and reports drained count when idle', async () => {
    let remainingJobs = 3;
    const onJobProcessed = vi.fn();
    const onIdle = vi.fn();
    const onError = vi.fn();
    const processNext = vi.fn(() => {
      if (remainingJobs > 0) {
        remainingJobs -= 1;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });

    const loop = startWorkerLoop({
      processNext,
      onJobProcessed,
      onIdle,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(processNext).toHaveBeenCalledTimes(4);
    expect(onJobProcessed).toHaveBeenCalledTimes(3);
    expect(onIdle).toHaveBeenCalledExactlyOnceWith(3);
    expect(onError).not.toHaveBeenCalled();

    await loop.stopAndDrain();
  });

  it('applies exponential idle backoff capped at maxIdleDelayMs and resets after work', async () => {
    const outcomes = [false, false, false, false, false, true, false, false];
    let index = 0;
    const processNext = vi.fn(() => {
      const outcome = outcomes[index] ?? false;
      index += 1;
      return Promise.resolve(outcome);
    });
    const onError = vi.fn();

    const loop = startWorkerLoop({
      processNext,
      onError,
      minIdleDelayMs: 500,
      maxIdleDelayMs: 5_000,
      backoffFactor: 2,
    });

    // 1st poll returns false -> sleeps 500ms
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(processNext).toHaveBeenCalledTimes(1);

    // 2nd poll returns false -> sleeps 1000ms
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(2);

    // 3rd poll after 1000ms -> returns false -> sleeps 2000ms
    await vi.advanceTimersByTimeAsync(1_000);
    expect(processNext).toHaveBeenCalledTimes(3);

    // 4th poll after 2000ms -> returns false -> sleeps 4000ms
    await vi.advanceTimersByTimeAsync(2_000);
    expect(processNext).toHaveBeenCalledTimes(4);

    // 5th poll after 4000ms -> returns false -> sleeps 5000ms (capped)
    await vi.advanceTimersByTimeAsync(4_000);
    expect(processNext).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(processNext).toHaveBeenCalledTimes(5);

    // 6th poll after 5000ms -> returns true, immediately drains 7th poll (false), resets delay to 500ms
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(7);

    // 8th poll runs after reset minIdleDelayMs (500ms)
    await vi.advanceTimersByTimeAsync(500);
    expect(processNext).toHaveBeenCalledTimes(8);
    expect(onError).not.toHaveBeenCalled();

    await loop.stopAndDrain();
  });

  it('backs off after unexpected errors instead of tight-looping', async () => {
    const dbError = new Error('connection refused');
    const processNext = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(dbError)
      .mockResolvedValue(false);
    const onError = vi.fn();

    const loop = startWorkerLoop({
      processNext,
      onError,
      minIdleDelayMs: 500,
      maxIdleDelayMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledExactlyOnceWith(dbError);
    expect(processNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(processNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(2);

    await loop.stopAndDrain();
  });

  it('stops immediately while sleeping and passes an aborted signal to in-flight work on stopAndDrain', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveInFlight!: (value: boolean) => void;
    const processNext = vi.fn((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<boolean>((resolve) => {
        resolveInFlight = resolve;
      });
    });
    const onIdle = vi.fn();
    const onError = vi.fn();

    const loop = startWorkerLoop({
      processNext,
      onIdle,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(false);

    const stopPromise = loop.stopAndDrain();
    expect(capturedSignal?.aborted).toBe(true);

    resolveInFlight(true);
    await stopPromise;

    expect(processNext).toHaveBeenCalledOnce();
    expect(onIdle).toHaveBeenCalledExactlyOnceWith(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
