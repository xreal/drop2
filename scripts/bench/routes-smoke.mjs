#!/usr/bin/env node
/** Verify receiver shell and static assets are served from the Worker. */

import { baseUrl, timed } from './lib.mjs';

const base = baseUrl();

const checks = [
  { name: 'receiver page', url: `${base}/s/AAAAAA`, expectStatus: 200, expectBody: 'shr' },
  { name: 'health', url: `${base}/api/v1/health`, expectStatus: 200, expectJson: { ok: true } },
];

let failed = false;

for (const check of checks) {
  const { result, ms } = await timed(async () => {
    const res = await fetch(check.url);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, text, json };
  });

  const statusOk = result.status === check.expectStatus;
  const bodyOk = check.expectJson
    ? result.json?.ok === check.expectJson.ok
    : result.text.includes(check.expectBody);

  if (statusOk && bodyOk) {
    console.log(`ok  ${check.name} (${ms.toFixed(1)}ms)`);
  } else {
    failed = true;
    console.error(`fail ${check.name}: status=${result.status}`);
  }
}

if (failed) process.exit(1);
