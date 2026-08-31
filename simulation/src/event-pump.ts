import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENT_PUMP_INTERVAL_MS = 2_000;
export const EVENT_PUMP_DURATION_MS = 15 * 60 * 1_000;

export type SyntheticEventKind = 'appointment' | 'observation' | 'followup';

export type SyntheticEvent = {
  kind: SyntheticEventKind;
  ordinal: number;
};

export type EventPumpOptions = {
  intervalMs?: number;
  durationMs?: number;
  dryRun?: boolean;
  emit?: (event: SyntheticEvent) => Promise<void>;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type EventPumpResult = {
  emitted: number;
  dryRun: boolean;
  stoppedBy: 'duration' | 'signal';
};

export async function runEventPump(options: EventPumpOptions = {}): Promise<EventPumpResult> {
  const intervalMs = options.intervalMs ?? EVENT_PUMP_INTERVAL_MS;
  const durationMs = options.durationMs ?? EVENT_PUMP_DURATION_MS;
  const dryRun = options.dryRun === true;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepWithSignal;
  const start = now();
  let emitted = 0;
  let stoppedBy: 'duration' | 'signal' = 'duration';
  const kinds: SyntheticEventKind[] = ['appointment', 'observation', 'followup'];

  const isAborted = (): boolean => options.signal?.aborted === true;

  while (true) {
    if (isAborted()) {
      stoppedBy = 'signal';
      break;
    }
    if (now() - start >= durationMs) {
      break;
    }

    const kind = kinds[emitted % kinds.length] ?? 'appointment';
    if (!dryRun && options.emit !== undefined) {
      await options.emit({ kind, ordinal: emitted });
    }
    emitted += 1;

    if (isAborted()) {
      stoppedBy = 'signal';
      break;
    }

    await sleep(intervalMs, options.signal);
  }

  return { emitted, dryRun, stoppedBy };
}

export function bindProcessShutdown(
  controller: AbortController,
  proc: NodeJS.EventEmitter = process,
): () => void {
  const stop = (): void => {
    controller.abort();
  };
  proc.on('SIGINT', stop);
  proc.on('SIGTERM', stop);
  return () => {
    proc.off('SIGINT', stop);
    proc.off('SIGTERM', stop);
  };
}

export function parseEventPumpArgs(argv: readonly string[]): {
  dryRun: boolean;
  intervalMs: number;
  durationMs: number;
} {
  let dryRun = false;
  let intervalMs = EVENT_PUMP_INTERVAL_MS;
  let durationMs = EVENT_PUMP_DURATION_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--interval-ms') {
      intervalMs = readPositiveInt(argv[index + 1], 'interval-ms');
      index += 1;
      continue;
    }
    if (arg === '--duration-ms') {
      durationMs = readPositiveInt(argv[index + 1], 'duration-ms');
      index += 1;
    }
  }

  return { dryRun, intervalMs, durationMs };
}

function readPositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid --${flag}`);
  }
  return parsed;
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function defaultEmit(event: SyntheticEvent): Promise<void> {
  process.stdout.write(`event ordinal=${event.ordinal} kind=${event.kind}\n`);
  return Promise.resolve();
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseEventPumpArgs(argv);
  const controller = new AbortController();
  const unbind = bindProcessShutdown(controller);
  try {
    const result = await runEventPump({
      intervalMs: parsed.intervalMs,
      durationMs: parsed.durationMs,
      dryRun: parsed.dryRun,
      signal: controller.signal,
      ...(parsed.dryRun ? {} : { emit: defaultEmit }),
    });
    process.stdout.write(`pump emitted=${result.emitted} dryRun=${String(result.dryRun)} stoppedBy=${result.stoppedBy}\n`);
  } finally {
    unbind();
  }
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  await main(process.argv.slice(2));
}
