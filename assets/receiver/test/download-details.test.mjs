import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDownloadDetails, downloadDetailLines } from '../src/download-details.js';

test('shows approximate country, region and network while tolerating missing details', () => {
  assert.deepEqual(downloadDetailLines({country:'DE', region:'Bavaria', network:'Example ISP', asn:64500}), [
    'Approx. location: Germany · Bavaria', 'Network: Example ISP · AS64500',
  ]);
  assert.deepEqual(downloadDetailLines(null), ['Location and network not recorded for this download.']);
  assert.deepEqual(downloadDetailLines({}), ['Location unavailable', 'Network unavailable']);
});

test('rejects malformed or oversized details', () => {
  assert.deepEqual(parseDownloadDetails({country:'invalid', region:'a'.repeat(101), network:7, asn:-1}), {
    country:null, region:null, network:null, asn:null,
  });
});
