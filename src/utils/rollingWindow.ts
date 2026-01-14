// src/utils/rollingWindow.ts
export class RollingWindow {
  private readonly size: number;
  private buf: number[] = [];
  private idx = 0;
  private filled = false;

  constructor(size: number) {
    if (!Number.isFinite(size) || size <= 0) throw new Error(`window size must be > 0 (got ${size})`);
    this.size = size;
    this.buf = new Array<number>(size).fill(0);
  }

  push(value: 0 | 1): void {
    this.buf[this.idx] = value;
    this.idx = (this.idx + 1) % this.size;
    if (this.idx === 0) this.filled = true;
  }

  count(): number {
    return this.filled ? this.size : this.idx;
  }

  failures(): number {
    const n = this.count();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.buf[i];
    return sum;
  }

  failureRate(): number {
    const n = this.count();
    if (n === 0) return 0;
    return this.failures() / n;
  }

  reset(): void {
    this.idx = 0;
    this.filled = false;
    this.buf.fill(0);
  }
}
