#!/usr/bin/env node
/** Run automated pre-launch benchmark smoke checks. */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.SHR_API_URL ?? 'http://127.0.0.1:8787';

console.log(`benchmark target: ${base}\n`);

const scripts = ['routes-smoke.mjs', 'health-latency.mjs'];

for (const script of scripts) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, script)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} failed`))));
  });
}

console.log('\nautomated checks passed');
console.log('manual gates: see scripts/bench/README.md');
