export class SecretApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? 'request failed');
    this.status = status;
    this.attemptsLeft = body?.attempts_left ?? null;
  }
}

export const createSecret = (sealed, { passphrase, expiresIn }) => call('/api/v1/secrets', {
  body: {
    ciphertext: sealed.ciphertext,
    link_hash: sealed.linkHash,
    key_hash: sealed.keyHash,
    passphrase,
    expires_in: expiresIn,
  },
});

export const fetchSecretStatus = (id, linkToken) =>
  call(`/api/v1/secrets/${id}/status`, { body: { link_token: linkToken } });

export const revealSecret = (id, { linkToken, keyToken }) =>
  call(`/api/v1/secrets/${id}/reveal`, { body: { link_token: linkToken, key_token: keyToken } });

export const destroySecret = (id, linkToken) =>
  call(`/api/v1/secrets/${id}`, { method: 'DELETE', body: { link_token: linkToken } });

async function call(path, { method = 'POST', body }) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new SecretApiError(0, null);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new SecretApiError(response.status, data);
  return data;
}
