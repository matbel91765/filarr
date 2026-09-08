/**
 * Rate Limiter Service
 *
 * Simple token bucket rate limiter for API calls.
 * Prevents excessive requests from the frontend.
 */

const DEFAULT_MAX_TOKENS = 100;
const DEFAULT_REFILL_RATE = 100; // tokens per minute
const REFILL_INTERVAL_MS = 60_000;

class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxTokens = DEFAULT_MAX_TOKENS, refillRate = DEFAULT_REFILL_RATE) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor((elapsed / REFILL_INTERVAL_MS) * this.refillRate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  getRemainingTokens(): number {
    this.refill();
    return this.tokens;
  }

  getWaitTimeMs(): number {
    if (this.tokens > 0) return 0;
    const tokensNeeded = 1;
    return Math.ceil((tokensNeeded / this.refillRate) * REFILL_INTERVAL_MS);
  }
}

// Global rate limiter instance
const globalBucket = new TokenBucket();

/**
 * Check if a request can be made. Returns true if allowed, false if rate limited.
 */
export function canMakeRequest(cost = 1): boolean {
  return globalBucket.tryConsume(cost);
}

/**
 * Get remaining request budget
 */
export function getRemainingRequests(): number {
  return globalBucket.getRemainingTokens();
}

/**
 * Get estimated wait time in ms before next request is allowed
 */
export function getWaitTimeMs(): number {
  return globalBucket.getWaitTimeMs();
}

export default globalBucket;
