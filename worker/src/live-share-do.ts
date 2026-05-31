import { DurableObject } from 'cloudflare:workers';
import type { Env, InitLiveShareParams, LiveShareInfoResponse } from './types';
import type { LiveShareStatus, ShareKind, WsControl } from './protocol';
import { pruneAbuseTracking, recordFailedPin } from './abuse-tracking';
import { verifyPin, pinRequired } from './pin';
import { isValidShareId } from './share-id';
import { accessDenied, jsonError, ErrorMsg } from './api-errors';
import { hashIp } from './ip-hash';
import {
  clearGlobalAccessFailures,
  globalIpBlocked,
  recordGlobalAccessFailure,
} from './access-guard';

interface StoredState {
  share_id: string;
  kind: ShareKind;
  name: string;
  size: number;
  wait_seconds: number;
  pin_salt: string;
  pin_hash: string;
  sender_token: string;
  status: LiveShareStatus;
  created_at: number;
  wait_expires_at: number;
  join_token: string | null;
  join_version: number;
  failed_pins: Record<string, number>;
  cooldown_until: Record<string, number>;
}

const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_PIN_FAILURES = 3;

export class LiveShareDO extends DurableObject<Env> {
  private state: StoredState | null = null;
  private senderSocket: WebSocket | null = null;
  private receiverSocket: WebSocket | null = null;
  private joinWaiters = new Map<
    number,
    {
      resolve: (key: string) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async fetch(request: Request): Promise<Response> {
    await this.loadState();
    const url = new URL(request.url);

    if (url.pathname.endsWith('/connect') && request.method === 'GET') {
      return this.handleConnect(request);
    }

    const path = url.pathname;

    if (path === '/init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    if (path === '/info' && request.method === 'GET') {
      return this.handleInfo();
    }
    if (path === '/admit' && request.method === 'POST') {
      return this.handleAdmit(request);
    }
    if (path === '/cancel' && request.method === 'POST') {
      return this.handleCancel(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    if (this.state) {
      return json({ error: 'share already initialized' }, 409);
    }

    let params: InitLiveShareParams;
    try {
      params = await request.json();
    } catch {
      return json({ error: 'invalid body' }, 400);
    }

    if (!isValidShareId(params.share_id)) {
      return json({ error: 'invalid share id' }, 400);
    }

    const now = Date.now();
    this.state = {
      share_id: params.share_id,
      kind: params.kind,
      name: params.name,
      size: params.size,
      wait_seconds: params.wait_seconds,
      pin_salt: params.pin_salt,
      pin_hash: params.pin_hash,
      sender_token: params.sender_token,
      status: 'waiting',
      created_at: now,
      wait_expires_at: now + params.wait_seconds * 1000,
      join_token: null,
      join_version: 0,
      failed_pins: {},
      cooldown_until: {},
    };

    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.setAlarm(this.state.wait_expires_at);

    return json({ ok: true });
  }

  private handleInfo(): Response {
    const s = this.requireState();
    if ('error' in s) return s.error;

    const body: LiveShareInfoResponse = {
      share_id: s.share_id,
      mode: 'live',
      kind: s.kind,
      name: s.name,
      size: s.size,
      pin_required: pinRequired(s.pin_hash),
      status: s.status,
    };
    return json(body);
  }

  private async handleAdmit(request: Request): Promise<Response> {
    const state = this.requireState();
    if ('error' in state) return denyAccess();
    const s = state;

    if (await globalIpBlocked(this.env, request)) {
      return denyAccess();
    }

    if (s.status === 'expired' || s.status === 'cancelled' || s.status === 'completed') {
      return denyAccess();
    }
    if (s.status === 'active') {
      return denyAccess();
    }
    if (!this.senderSocket || this.senderSocket.readyState !== WebSocket.OPEN) {
      return denyAccess();
    }

    let body: { client_public_key?: string; pin?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: ErrorMsg.INVALID_REQUEST }, 400);
    }

    const clientKey = body.client_public_key;
    if (!clientKey) return json({ error: ErrorMsg.INVALID_REQUEST }, 400);

    const ip = request.headers.get('x-shr-ip') ?? 'unknown';
    const ipKey = await hashIp(ip);
    const now = Date.now();
    this.pruneAbuseTracking(now);

    const cooldown = s.cooldown_until[ipKey] ?? 0;
    if (now < cooldown) {
      await recordGlobalAccessFailure(this.env, request);
      return denyAccess();
    }

    if (pinRequired(s.pin_hash)) {
      const pin = body.pin;
      if (!pin) {
        await recordGlobalAccessFailure(this.env, request);
        return denyAccess();
      }
      const ok = await verifyPin(pin, s.pin_salt, s.pin_hash);
      if (!ok) {
        const fails = (s.failed_pins[ipKey] ?? 0) + 1;
        const cooldownUntil = fails >= MAX_PIN_FAILURES ? now + COOLDOWN_MS : null;
        recordFailedPin(s, ipKey, cooldownUntil);
        this.pruneAbuseTracking(now);
        await this.persist();
        await recordGlobalAccessFailure(this.env, request);
        return denyAccess();
      }
    }

    if (s.failed_pins[ipKey] || s.cooldown_until[ipKey]) {
      delete s.failed_pins[ipKey];
      delete s.cooldown_until[ipKey];
      this.pruneAbuseTracking(now);
    }

    await clearGlobalAccessFailures(this.env, request);

    s.join_version += 1;
    const version = s.join_version;
    const joinToken = crypto.randomUUID();
    s.join_token = joinToken;
    s.status = 'waiting';
    await this.persist();

    try {
      const serverKey = await this.requestSenderJoin(clientKey, version);
      s.status = 'active';
      await this.persist();
      return json({
        server_public_key: serverKey,
        join_token: joinToken,
        status: s.status,
      });
    } catch {
      s.join_token = null;
      s.status = 'waiting';
      await this.persist();
      return json({ error: 'join failed' }, 502);
    }
  }

  private async handleConnect(request: Request): Promise<Response> {
    const s = this.requireState();
    if ('error' in s) return s.error;

    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const token = url.searchParams.get('token');
    if (!role || !token) return json({ error: 'missing role or token' }, 400);

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'websocket required' }, 426);
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    if (role === 'sender') {
      if (token !== s.sender_token) {
        server.close(4401, 'invalid sender token');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (this.senderSocket) {
        this.senderSocket.close(1000, 'replaced');
      }
      this.senderSocket = server;
      this.attachSender(server);
      this.sendState(server, s.status);
    } else if (role === 'receiver') {
      if (!s.join_token || token !== s.join_token) {
        server.close(4401, 'invalid join token');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (this.receiverSocket) {
        server.close(1008, 'receiver already connected');
        return new Response(null, { status: 101, webSocket: client });
      }
      this.receiverSocket = server;
      this.attachReceiver(server);
      if (this.senderSocket?.readyState === WebSocket.OPEN) {
        this.sendControl(this.senderSocket, { type: 'receiver_connected' });
      }
    } else {
      server.close(1008, 'invalid role');
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleCancel(request: Request): Promise<Response> {
    const s = this.requireState();
    if ('error' in s) return s.error;

    let body: { token?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid body' }, 400);
    }

    if (body.token !== s.sender_token) {
      return json({ error: 'unauthorized' }, 401);
    }

    await this.closeShare('cancelled');
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    await this.loadState();
    if (!this.state) return;
    if (this.state.status === 'waiting' && Date.now() >= this.state.wait_expires_at) {
      await this.closeShare('expired');
    }
  }

  private attachSender(ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        this.onSenderControl(data);
      } else if (data instanceof ArrayBuffer) {
        this.relayToReceiver(data);
      }
    });
    ws.addEventListener('close', () => {
      if (this.senderSocket === ws) {
        this.senderSocket = null;
        if (this.state && !terminalStatus(this.state.status)) {
          void this.closeShare('failed');
        }
      }
    });
  }

  private attachReceiver(ws: WebSocket) {
    ws.addEventListener('close', () => {
      if (this.receiverSocket === ws) {
        this.receiverSocket = null;
      }
    });
  }

  private onSenderControl(raw: string) {
    let msg: WsControl;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'join_response' && msg.server_public_key) {
      const version = this.state?.join_version ?? 0;
      const waiter = this.joinWaiters.get(version);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.joinWaiters.delete(version);
        waiter.resolve(msg.server_public_key);
      }
    }

    if (msg.type === 'transfer_complete') {
      if (this.receiverSocket?.readyState === WebSocket.OPEN) {
        this.sendControl(this.receiverSocket, { type: 'transfer_complete' });
      }
      void this.closeShare('completed');
    }
  }

  private relayToReceiver(data: ArrayBuffer) {
    if (this.receiverSocket?.readyState === WebSocket.OPEN) {
      this.receiverSocket.send(data);
    }
  }

  private requestSenderJoin(clientKey: string, version: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.senderSocket || this.senderSocket.readyState !== WebSocket.OPEN) {
        reject(new Error('sender offline'));
        return;
      }

      const timer = setTimeout(() => {
        this.joinWaiters.delete(version);
        reject(new Error('join timeout'));
      }, 30_000);

      this.joinWaiters.set(version, { resolve, reject, timer });
      this.sendControl(this.senderSocket, {
        type: 'join_request',
        client_public_key: clientKey,
      });
    });
  }

  private sendControl(ws: WebSocket, msg: WsControl) {
    ws.send(JSON.stringify(msg));
  }

  private sendState(ws: WebSocket, status: LiveShareStatus) {
    this.sendControl(ws, { type: 'state', status });
  }

  private async closeShare(status: LiveShareStatus) {
    if (!this.state) return;
    this.state.status = status;
    await this.persist();
    await this.ctx.storage.deleteAlarm();

    for (const waiter of this.joinWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('share closed'));
    }
    this.joinWaiters.clear();

    this.senderSocket?.close(1000, status);
    this.receiverSocket?.close(1000, status);
    this.senderSocket = null;
    this.receiverSocket = null;
  }

  private requireState(): StoredState | { error: Response } {
    if (!this.state) {
      return { error: json({ error: 'share unavailable' }, 404) };
    }
    return this.state;
  }

  private async loadState() {
    if (this.state) return;
    this.state = (await this.ctx.storage.get<StoredState>('state')) ?? null;
  }

  private async persist() {
    if (this.state) {
      await this.ctx.storage.put('state', this.state);
    }
  }

  private pruneAbuseTracking(now: number) {
    if (!this.state) return;
    pruneAbuseTracking(this.state, now);
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void this.loadState();
  }
}

function terminalStatus(status: LiveShareStatus): boolean {
  return (
    status === 'completed' ||
    status === 'expired' ||
    status === 'cancelled' ||
    status === 'failed'
  );
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function denyAccess(): Response {
  return accessDenied();
}
