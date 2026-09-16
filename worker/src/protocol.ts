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

export type StoredShareStatus =
  | 'uploading'
  | 'ready'
  | 'expired'
  | 'deleted'
  | 'failed';

export type WsControl =
  | {
      type: 'join_request';
      client_public_key: string;
      client_proof: string;
      request_id: number;
    }
  | {
      type: 'join_response';
      server_public_key: string;
      server_proof: string;
      request_id: number;
    }
  | {
      type: 'join_rejected';
      request_id: number;
    }
  | {
      type: 'receiver_connected';
    }
  | {
      type: 'transfer_complete';
      plaintext_bytes: number;
      completion_proof: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    }
  | {
      type: 'state';
      status: LiveShareStatus;
      sender_online: boolean;
    };
