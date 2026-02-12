export class RateLimiter {
  private requests: Map<number, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 20, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isLimited(userId: number): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(userId) ?? [];

    // Remove expired entries
    const valid = userRequests.filter((ts) => now - ts < this.windowMs);

    if (valid.length >= this.maxRequests) {
      this.requests.set(userId, valid);
      return true;
    }

    valid.push(now);
    this.requests.set(userId, valid);
    return false;
  }
}
