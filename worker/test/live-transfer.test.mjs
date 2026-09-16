import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, pin } from './runtime.mjs';
import { createLiveAccess, completeLiveJoin, verifyLiveCompletion } from '../../assets/receiver/src/live-crypto.js';
import { b64urlDecode } from '../../assets/receiver/src/stored-crypto.js';
import { createFrameState, appendEncryptedFrames, finalizeEncryptedFrames } from '../../assets/receiver/src/frame-stream.js';

function printedLink(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/Link: (\S+)/);
      if (match) resolve(new URL(match[1]));
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`sender exited before printing a link: ${code}`)));
  });
}

function receive(socket, key, expectedBytes) {
  socket.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    const state = createFrameState();
    socket.addEventListener('message', event => {
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'transfer_complete') {
            verifyLiveCompletion(key, state.receivedBytes, message);
            assert.equal(state.receivedBytes, expectedBytes, 'authenticated bytes before completion');
            resolve(finalizeEncryptedFrames(state, {expectedBytes, requireTransferComplete:true, transferComplete:true}));
          }
        } else {
          assert.ok(event.data instanceof ArrayBuffer, `unexpected binary message: ${Object.prototype.toString.call(event.data)}`);
          appendEncryptedFrames(state, new Uint8Array(event.data), key);
        }
      } catch (error) { reject(error); }
    });
    socket.addEventListener('error', reject);
    socket.addEventListener('close', () => reject(new Error('closed without authenticated data and completion')));
    socket.accept();
  });
}

test('actual Rust sender rejects an unauthenticated relay join and serves an authenticated browser receiver', {timeout:30_000}, async () => {
  const runtime = await createRuntime();
  const directory = await mkdtemp(join(tmpdir(), 'drop2-live-security-'));
  let child;
  let receiver;
  try {
    const expected = Buffer.alloc(150_000, 7);
    const path = join(directory, 'file.bin');
    await writeFile(path, expected);
    const origin = (await runtime.mf.ready).origin;
    child = spawn(fileURLToPath(new URL('../../target/debug/drop2', import.meta.url)), ['--pin', pin, path], {
      env:{...process.env, DROP2_API_URL:origin}, stdio:['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    const link = await printedLink(child);
    assert.equal(link.origin, origin);
    const shareId = link.pathname.split('/').pop();
    const capability = b64urlDecode(link.hash.slice(1));
    assert.equal(capability.length, 32);
    const privateKey = new Uint8Array(32).fill(3);
    const accessBody = createLiveAccess(capability, shareId, privateKey);
    const denied = await runtime.request(`/api/v1/live/${shareId}/access`, {
      ...accessBody, pin, client_proof:'A'.repeat(43),
    });
    assert.equal(denied.status, 502);
    const admitted = await runtime.request(`/api/v1/live/${shareId}/access`, {...accessBody, pin});
    assert.equal(admitted.status, 200);
    const access = await admitted.json();
    const key = completeLiveJoin(capability, shareId, privateKey, access);
    const response = await runtime.mf.dispatchFetch(`http://localhost${access.connect_url}`, {headers:{Upgrade:'websocket'}});
    assert.equal(response.status, 101);
    receiver = response.webSocket;
    assert.deepEqual(Buffer.from(await receive(receiver, key, expected.length)), expected);
    assert.equal((await exited)[0], 0);
  } finally {
    receiver?.close();
    if (child && child.exitCode === null) child.kill('SIGKILL');
    await runtime.mf.dispose();
    await rm(directory, {recursive:true, force:true});
  }
});

test('CLI stored folders declare the actual ZIP size and round-trip under strict upload limits', {timeout:30_000}, async () => {
  const runtime = await createRuntime();
  const directory = await mkdtemp(join(tmpdir(), 'drop2-stored-security-'));
  const children = [];
  try {
    const folder = join(directory, 'documents');
    await mkdir(folder);
    const expected = Buffer.from('authenticated folder contents');
    await writeFile(join(folder, 'note.txt'), expected);
    const origin = (await runtime.mf.ready).origin;
    const binary = fileURLToPath(new URL('../../target/debug/drop2', import.meta.url));
    const options = {env:{...process.env, DROP2_API_URL:origin}, stdio:['ignore', 'pipe', 'pipe']};
    const sender = spawn(binary, ['--keep', '--pin', pin, folder], options);
    children.push(sender);
    const sent = once(sender, 'exit');
    const link = await printedLink(sender);
    assert.equal((await sent)[0], 0);
    const shareId = link.pathname.split('/').pop();
    const info = await (await runtime.request(`/api/v1/stored/${shareId}`)).json();
    assert.ok(info.size > expected.length);
    const destination = join(directory, 'received.zip');
    const receiver = spawn(binary, ['get', link.href, '--pin', pin, '--output', destination], options);
    children.push(receiver);
    assert.equal((await once(receiver, 'exit'))[0], 0);
    const received = await readFile(destination);
    assert.equal(received.length, info.size);
    assert.equal(received.readUInt32LE(), 0x04034b50);
    assert.ok(received.includes(expected));
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    await runtime.mf.dispose();
    await rm(directory, {recursive:true, force:true});
  }
});
