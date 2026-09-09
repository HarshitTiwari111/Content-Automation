import { logger } from './logger.js';

/**
 * Kuch ISP connections pe DNS beech-beech me fail ho jaata hai
 * ("getaddrinfo ENOTFOUND"). Aisi galtiyan thodi der baad apne aap theek ho
 * jaati hain, isliye inhe dobara try karna chahiye.
 */
const RETRYABLE = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EPIPE',
  'socket hang up',
  'network socket disconnected',
  'fetch failed',
];

function isRetryable(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { code?: string }).code ?? '')}` : String(error);
  return RETRYABLE.some((needle) => text.includes(needle));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Network wale kaam ko 3 baar try karta hai (2s, 4s ke gap se).
 * Sirf network errors pe retry hota hai — asli errors turant upar chale jaate hain.
 */
export async function withRetry<T>(what: string, action: () => Promise<T>): Promise<T> {
  const attempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;

      const delay = 2000 * attempt;
      logger.warn(
        `${what} — network problem (try ${attempt}/${attempts}). ${delay / 1000}s baad dobara koshish...`,
      );
      await wait(delay);
    }
  }

  throw lastError;
}
