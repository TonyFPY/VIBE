const bucketUpperBounds = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, Infinity] as const;

export interface TimingSummary {
  count: number;
  totalMs: number;
  medianUpperBoundMs: number;
  p95UpperBoundMs: number;
}

export class TimingHistogram {
  private readonly counts = new Uint32Array(bucketUpperBounds.length);
  private count = 0;
  private totalMs = 0;

  observe(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Timing must be a finite non-negative number");
    this.count += 1;
    this.totalMs += milliseconds;
    const index = bucketUpperBounds.findIndex((upperBound) => milliseconds <= upperBound);
    this.counts[index < 0 ? this.counts.length - 1 : index] += 1;
  }

  summary(): TimingSummary {
    return {
      count: this.count,
      totalMs: this.totalMs,
      medianUpperBoundMs: this.quantileUpperBound(0.5),
      p95UpperBoundMs: this.quantileUpperBound(0.95),
    };
  }

  private quantileUpperBound(quantile: number): number {
    if (this.count === 0) return 0;
    const target = Math.ceil(this.count * quantile);
    let cumulative = 0;
    for (let index = 0; index < this.counts.length; index += 1) {
      cumulative += this.counts[index];
      if (cumulative >= target) return bucketUpperBounds[index];
    }
    return Infinity;
  }
}
