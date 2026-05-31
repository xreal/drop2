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
    }
  | {
      type: 'join_response';
      server_public_key: string;
    }
  | {
      type: 'receiver_connected';
    }
  | {
      type: 'transfer_complete';
    }
  | {
      type: 'error';
      code: string;
      message: string;
    }
  | {
      type: 'state';
      status: LiveShareStatus;
    };
