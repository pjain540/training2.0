/**
 * Check whether an error is transient and retriable (rate limit, service overloaded, network timeout).
 */
export function isTransientError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || (err.error && err.error.code);
  return (
    status === 429 || // Rate limited / Quota spike
    status === 500 || // Internal server error
    status === 502 || // Bad gateway
    status === 503 || // Service unavailable / High demand
    status === 504 || // Gateway timeout
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    (typeof err.message === 'string' && (
      err.message.includes('experiencing high demand') ||
      err.message.includes('quota') ||
      err.message.includes('RESOURCE_EXHAUSTED')
    ))
  );
}

/**
 * Extracts recommended retry delay in ms from Google API RetryInfo or error message if provided.
 */
export function extractRetryDelayMs(err) {
  if (!err) return 0;

  // Check err.details array for RetryInfo
  if (err.details && Array.isArray(err.details)) {
    const retryInfo = err.details.find(d => d && d.retryDelay);
    if (retryInfo && retryInfo.retryDelay) {
      const seconds = parseFloat(retryInfo.retryDelay);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }
    }
  }

  // Check error message string for "retry in Xs"
  if (typeof err.message === 'string') {
    const match = err.message.match(/retry in\s+([0-9.]+)\s*s/i);
    if (match && match[1]) {
      const seconds = parseFloat(match[1]);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }
    }
  }

  return 0;
}

/**
 * Executes an asynchronous function with exponential backoff, server RetryInfo respect, and full jitter.
 *
 * Formula: Delay = max(serverRetryDelay, 2^attempt * baseDelayMs) + randomJitter
 *
 * @param {Function} fn - Async operation to execute
 * @param {Object} options
 * @param {number} [options.maxRetries=5] - Max retry attempts
 * @param {number} [options.baseDelayMs=1000] - Base delay in milliseconds
 * @param {Function} [options.onRetry] - Callback invoked on retry attempt
 */
export async function withRetry(fn, {
  maxRetries = 5,
  baseDelayMs = 1000,
  onRetry = null
} = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (!isTransientError(err) || attempt > maxRetries) {
        throw err;
      }

      // Check if server specified an exact retryDelay window (e.g. Google's 429 RetryInfo)
      const serverDelay = extractRetryDelayMs(err);

      // Exponential backoff with jitter
      const exponential = Math.pow(2, attempt) * baseDelayMs;
      const jitter = Math.random() * 500;
      const computedDelay = Math.round(exponential + jitter);

      // Use the greater of server recommended delay or exponential backoff
      const delay = Math.max(serverDelay ? serverDelay + 500 : 0, computedDelay);

      if (typeof onRetry === 'function') {
        onRetry(attempt, maxRetries, delay, err);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
