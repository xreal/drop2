#!/usr/bin/env node
/** Measure /api/v1/health latency against SHR_API_URL. */

import { baseUrl, sampleCount, summarize, printSummary, timed } from './lib.mjs';

const url = `${baseUrl()}/api/v1/health`;
const samples = sampleCount();
const durations = [];

for (let i = 0; i < samples; i += 1) {
  const { result, ms } = await timed(async () => {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await res.json();
    return { ok: res.ok, body };
  });

  if (!result.ok || !result.body?.ok) {
    console.error(`health check failed on sample ${i + 1}:`, result);
    process.exit(1);
  }

  durations.push(ms);
}

printSummary(summarize('health latency', durations));
