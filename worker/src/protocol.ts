export type ShareMode = 'live' | 'stored';
export type ShareKind = 'file' | 'folder';

export type LiveShareStatus =
  | 'creating'
  | 'waiting'
  | 'active'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed';

export interface WsControl {
  type: string;
  client_public_key?: string;
  server_public_key?: string;
  code?: string;
  message?: string;
  status?: LiveShareStatus;
}
