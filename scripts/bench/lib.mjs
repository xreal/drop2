/** Shared config for pre-launch benchmark scripts. */

export function baseUrl() {
  const url = (process.env.SHR_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  return url;
}

export function sampleCount() {
  const n = Number(process.env.SHR_BENCH_SAMPLES ?? 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

export function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function summarize(label, durationsMs) {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    label,
    samples: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
  };
}

export function printSummary(stats) {
  const fmt = (n) => `${n.toFixed(1)}ms`;
  console.log(
    `${stats.label}: n=${stats.samples} min=${fmt(stats.min)} p50=${fmt(stats.p50)} p95=${fmt(stats.p95)} max=${fmt(stats.max)} avg=${fmt(stats.avg)}`,
  );
}

export async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}
