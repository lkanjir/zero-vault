const DEFAULT_MIN_IDLE_DELAY_MS = 500;
const DEFAULT_MAX_IDLE_DELAY_MS = 5_000;
const DEFAULT_BACKOFF_FACTOR = 2;

export type WorkerLoopOptions = {
  readonly processNext: (signal: AbortSignal) => Promise<boolean>;
  readonly onJobProcessed?: () => void;
  readonly onIdle?: (drainedCount: number) => void;
  readonly onError: (error: unknown) => void;
  readonly minIdleDelayMs?: number;
  readonly maxIdleDelayMs?: number;
  readonly backoffFactor?: number;
};

export type ManagedWorkerLoop = {
  readonly stopAndDrain: () => Promise<void>;
};

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function startWorkerLoop(options: WorkerLoopOptions): ManagedWorkerLoop {
  const minIdleDelayMs = options.minIdleDelayMs ?? DEFAULT_MIN_IDLE_DELAY_MS;
  const maxIdleDelayMs = options.maxIdleDelayMs ?? DEFAULT_MAX_IDLE_DELAY_MS;
  const backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;

  const controller = new AbortController();
  let idleDelayMs = minIdleDelayMs;
  let drainedCount = 0;

  const loopPromise = (async () => {
    while (!controller.signal.aborted) {
      try {
        const processed = await options.processNext(controller.signal);

        if (processed) {
          drainedCount += 1;
          idleDelayMs = minIdleDelayMs;
          options.onJobProcessed?.();
          continue;
        }

        if (drainedCount > 0) {
          options.onIdle?.(drainedCount);
          drainedCount = 0;
        }

        await sleepWithAbort(idleDelayMs, controller.signal);
        idleDelayMs = Math.min(Math.round(idleDelayMs * backoffFactor), maxIdleDelayMs);
      } catch (error) {
        if (controller.signal.aborted) {
          break;
        }

        options.onError(error);
        await sleepWithAbort(idleDelayMs, controller.signal);
        idleDelayMs = Math.min(Math.round(idleDelayMs * backoffFactor), maxIdleDelayMs);
      }
    }

    if (drainedCount > 0) {
      options.onIdle?.(drainedCount);
      drainedCount = 0;
    }
  })();

  return {
    async stopAndDrain() {
      controller.abort();
      await loopPromise;
    },
  };
}
