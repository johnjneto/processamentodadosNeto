import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly timings: number[] = [];

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observeLatencyMs(ms: number): void {
    this.timings.push(ms);
    if (this.timings.length > 1000) this.timings.shift();
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[`counter.${k}`] = v;
    for (const [k, v] of this.gauges) out[`gauge.${k}`] = v;
    if (this.timings.length) {
      const avg =
        this.timings.reduce((a, b) => a + b, 0) / this.timings.length;
      out['latency_ms_avg'] = Math.round(avg);
    }
    return out;
  }
}
