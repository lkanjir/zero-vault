import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown } from '../../src/shared/runtime/graceful-shutdown.js';

describe('registerGracefulShutdown', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs shutdown cleanup once and exits with code 0 on SIGTERM', async () => {
    const emitter = new EventEmitter();
    let resolveCleanup!: () => void;
    const onShutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );
    const exit = vi.fn();

    const unregister = registerGracefulShutdown({
      name: 'Test worker',
      onShutdown,
      processTarget: emitter,
      exit,
    });

    emitter.emit('SIGTERM');
    emitter.emit('SIGINT');

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();

    resolveCleanup();
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    unregister();
  });

  it('exits with code 1 when shutdown cleanup throws', async () => {
    const emitter = new EventEmitter();
    const onShutdown = vi.fn().mockRejectedValue(new Error('pool close failed'));
    const exit = vi.fn();

    const unregister = registerGracefulShutdown({
      name: 'Test server',
      onShutdown,
      processTarget: emitter,
      exit,
    });

    emitter.emit('SIGINT');

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
    expect(console.error).toHaveBeenCalledOnce();

    unregister();
  });

  it('exits with code 1 when shutdown exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    const emitter = new EventEmitter();
    const onShutdown = vi.fn(() => new Promise<void>(() => undefined));
    const exit = vi.fn();

    const unregister = registerGracefulShutdown({
      name: 'Stuck worker',
      onShutdown,
      timeoutMs: 1_000,
      processTarget: emitter,
      exit,
    });

    emitter.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(console.error).toHaveBeenCalledOnce();

    unregister();
  });
});
