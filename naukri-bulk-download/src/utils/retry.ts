import { delay } from './delay.js';
import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const label = options.label ?? 'operation';

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;

      const backoff = Math.min(
        baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500,
        maxDelayMs,
      );
      logger.warn(`${label} failed, retrying`, {
        attempt,
        maxAttempts,
        backoffMs: Math.round(backoff),
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(backoff);
    }
  }

  throw lastError;
}
