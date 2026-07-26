import { delay } from './stub-server.ts';

/**
 * Polls until `predicate` holds. Tests that assert on something a socket will
 * deliver shortly need this; a fixed sleep is either slow or flaky.
 */
export async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error(`timed out after ${String(timeoutMs)}ms waiting for ${description}`);
}
