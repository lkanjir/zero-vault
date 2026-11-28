import type { Server } from 'node:http';
import cron, { type ScheduledTask } from 'node-cron';

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export type SignalSource = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

export type GracefulShutdownOptions = {
  readonly name: string;
  readonly onShutdown: () => Promise<void>;
  readonly timeoutMs?: number;
  readonly signals?: readonly ShutdownSignal[];
  readonly processTarget?: SignalSource;
  readonly exit?: (code: number) => void;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;
const DEFAULT_SIGNALS: readonly ShutdownSignal[] = ['SIGTERM', 'SIGINT'];

export function registerGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const signals = options.signals ?? DEFAULT_SIGNALS;
  const processTarget = options.processTarget ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let shutdownPromise: Promise<void> | null = null;

  const triggerShutdown = (signal: ShutdownSignal) => {
    if (shutdownPromise !== null) {
      return;
    }

    console.info(`${options.name} shutting down`, { signal });

    shutdownPromise = (async () => {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Graceful shutdown timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          timeoutHandle.unref();
        });

        await Promise.race([options.onShutdown(), timeoutPromise]);
        console.info(`${options.name} shut down gracefully`, { signal });
        exit(0);
      } catch (error) {
        console.error(`${options.name} failed to shut down cleanly`, { signal, error });
        exit(1);
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    })();
  };

  const listeners = signals.map((signal) => {
    const listener = () => triggerShutdown(signal);
    processTarget.on(signal, listener);
    return { signal, listener };
  });

  return () => {
    for (const { signal, listener } of listeners) {
      processTarget.off(signal, listener);
    }
  };
}

export async function runShutdownSteps(steps: readonly (() => Promise<void>)[]): Promise<void> {
  const errors: unknown[] = [];

  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple shutdown steps failed');
  }
}

export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export type ManagedCronTask = {
  readonly task: ScheduledTask;
  readonly stopAndDrain: () => Promise<void>;
};

export function scheduleManagedCronTask(options: {
  readonly expression: string;
  readonly run: () => Promise<void>;
  readonly onError: (error: unknown) => void;
}): ManagedCronTask {
  let activeRun: Promise<void> | null = null;

  const task = cron.schedule(
    options.expression,
    () => {
      const runPromise = options.run().finally(() => {
        if (activeRun === runPromise) {
          activeRun = null;
        }
      });

      activeRun = runPromise;
      return runPromise;
    },
    { noOverlap: true },
  );

  task.on('execution:failed', (context) => {
    options.onError(context.execution?.error);
  });

  return {
    task,
    async stopAndDrain() {
      await Promise.resolve(task.stop());
      await activeRun?.catch(() => undefined);
    },
  };
}
