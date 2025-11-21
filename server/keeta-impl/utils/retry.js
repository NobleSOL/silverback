// Retry utility for TX2 operations
// Prevents fund loss by retrying transient failures

/**
 * Execute a function with exponential backoff retry
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable (default: all errors)
 * @returns {Promise} Result of successful execution
 * @throws {Error} Last error if all retries fail
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    shouldRetry = () => true,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Attempt to execute the function
      const result = await fn();

      // Success! Log if this was a retry
      if (attempt > 0) {
        console.log(`✅ Retry successful after ${attempt} attempt(s)`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        console.error(`❌ All ${maxRetries} retry attempts failed:`, error.message);
        throw error;
      }

      // Check if error is retryable
      if (!shouldRetry(error)) {
        console.error(`❌ Non-retryable error:`, error.message);
        throw error;
      }

      // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s (capped at maxDelay)
      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

      console.log(`🔄 Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
      console.log(`   Retrying in ${delay}ms...`);

      // Call onRetry callback if provided
      if (onRetry) {
        await onRetry(attempt, error, delay);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Common retry strategies for different error types
 */
export const retryStrategies = {
  /**
   * Retry all errors (default strategy)
   */
  always: () => true,

  /**
   * Never retry (fail fast)
   */
  never: () => false,

  /**
   * Retry only network/timeout errors, not validation errors
   */
  transientOnly: (error) => {
    const message = error.message.toLowerCase();

    // Don't retry validation errors
    if (message.includes('invalid') ||
        message.includes('not found') ||
        message.includes('insufficient')) {
      return false;
    }

    // Retry network/timeout errors
    if (message.includes('timeout') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('fetch failed')) {
      return true;
    }

    // Retry blockchain errors
    if (message.includes('block') ||
        message.includes('transaction')) {
      return true;
    }

    // Default: retry all other errors
    return true;
  },

  /**
   * Retry blockchain-specific errors
   */
  blockchainOnly: (error) => {
    const message = error.message.toLowerCase();
    return message.includes('block') ||
           message.includes('transaction') ||
           message.includes('nonce') ||
           message.includes('gas');
  },
};

/**
 * Helper: Execute TX2 with retry logic
 * Specialized retry for transaction operations
 *
 * @param {Function} tx2Function - Function that executes TX2
 * @param {string} transactionId - Optional transaction ID for tracking
 * @returns {Promise} TX2 result
 */
export async function executeTX2WithRetry(tx2Function, transactionId = null) {
  return retryWithBackoff(tx2Function, {
    maxRetries: 3,
    initialDelay: 1000,  // 1s
    maxDelay: 8000,      // 8s max
    shouldRetry: retryStrategies.transientOnly,
    onRetry: async (attempt, error, delay) => {
      console.log(`🔄 TX2 retry ${attempt + 1}/3: ${error.message}`);

      if (transactionId) {
        // TODO: Update transaction retry count in database
        // await updateRetryCount(transactionId, attempt + 1);
      }
    },
  });
}
