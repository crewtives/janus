import PQueue from "p-queue";
import pRetry, { AbortError } from "p-retry";

export interface QueueOptions {
  concurrency: number;
  intervalCap: number;
  intervalMs: number;
  taskTimeoutMs: number;
  retries: number;
}

export function makeQueue(opts: QueueOptions): PQueue {
  // No timeout at the p-queue level: the per-LLM-call timeout already lives
  // in RunOptions.timeoutMs (~30min per date). When a queue task represents
  // "an entire project" (several serialized dates), the per-date timeout is
  // the right granularity — not a total cap on the project.
  void opts.taskTimeoutMs;
  return new PQueue({
    concurrency: opts.concurrency,
    intervalCap: opts.intervalCap,
    interval: opts.intervalMs,
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; signal?: AbortSignal },
): Promise<T> {
  return pRetry(fn, {
    retries: opts.retries,
    minTimeout: 5_000,
    factor: 2,
    signal: opts.signal,
  });
}

export { AbortError };
