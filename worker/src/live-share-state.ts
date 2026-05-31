import type { LiveShareStatus } from './protocol';

export interface TransferCompleteTransition {
  nextStatus: LiveShareStatus;
  closeSender: boolean;
  closeReceiver: boolean;
  clearJoinToken: boolean;
}

export function transferCompleteTransition(
  current: LiveShareStatus,
): TransferCompleteTransition | null {
  if (terminalStatus(current)) {
    return null;
  }

  return {
    nextStatus: 'completed',
    closeSender: true,
    closeReceiver: false,
    clearJoinToken: true,
  };
}

function terminalStatus(status: LiveShareStatus): boolean {
  return (
    status === 'completed' ||
    status === 'expired' ||
    status === 'cancelled' ||
    status === 'failed'
  );
}
