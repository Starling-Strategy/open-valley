/** In-memory token bucket per client key. Per process; not shared across replicas. */
export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(private readonly options: { burst: number; perMinute: number; maxKeys?: number },
    private readonly now: () => number = Date.now) {}

  /** Spend one token. Returns 0 when allowed, else seconds until the next token. */
  take(key: string): number {
    const { burst, perMinute } = this.options;
    const rate = perMinute / 60_000;
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: burst, updated: now };
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.updated) * rate);
    bucket.updated = now;
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    this.evict(now, rate);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) / rate / 1000);
  }

  private evict(now: number, rate: number) {
    const maxKeys = this.options.maxKeys ?? 10_000;
    if (this.buckets.size <= maxKeys) return;
    // Refilled buckets carry no state; drop them first, then the least recent.
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.updated) * rate >= this.options.burst) this.buckets.delete(key);
    }
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= maxKeys) break;
      this.buckets.delete(key);
    }
  }
}

/**
 * Client address behind Cloudflare and Traefik. Prefer Cloudflare's header,
 * then the address the nearest proxy appended to X-Forwarded-For.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map(part => part.trim()).filter(Boolean);
  return headers.get("cf-connecting-ip")?.trim() || forwarded?.at(-1) || headers.get("x-real-ip")?.trim() || "unknown";
}
