/**
 * Helper to call an LLM function with retry on transient 503/429 errors.
 */
export async function withRetry(fn, { maxRetries = 3, delayMs = 1500, label = 'LLM' } = {}) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isTransient = err.status === 503 || err.status === 429 || err.message?.includes('high demand');
      if (isTransient && attempt < maxRetries) {
        const waitTime = delayMs * attempt;
        console.warn(`[${label}] Transient ${err.status || 'spike'} (Attempt ${attempt}/${maxRetries}). Retrying in ${waitTime}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
      } else {
        throw err;
      }
    }
  }
}
