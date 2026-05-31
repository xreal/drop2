import type { LiveShareStatus, ShareKind, ShareMode } from './protocol';

export type { ShareKind, ShareMode, LiveShareStatus };

export interface Env {
  LIVE_SHARE: DurableObjectNamespace;
  ASSETS: Fetcher;
  DB: D1Database;
  STORED: R2Bucket;
}

export interface CreateLiveShareBody {
  kind: ShareKind;
  name: string;
  size: number;
  wait_seconds: number;
  pin_salt: string;
  pin_hash: string;
}

export interface LiveShareInfoResponse {
  share_id: string;
  mode: ShareMode;
  kind: ShareKind;
  name: string;
  size: number;
  pin_required: boolean;
  status: LiveShareStatus;
}

export interface LiveAccessBody {
  client_public_key: string;
  pin?: string;
}

export interface LiveAccessResponse {
  server_public_key: string;
  join_token: string;
  connect_url: string;
  status: LiveShareStatus;
}

export interface InitLiveShareParams {
  share_id: string;
  kind: ShareKind;
  name: string;
  size: number;
  wait_seconds: number;
  pin_salt: string;
  pin_hash: string;
  sender_token: string;
}

export interface CreateLiveShareResult {
  share_id: string;
  sender_token: string;
}

export interface JoinAdmissionResult {
  server_public_key: string;
  join_token: string;
}
