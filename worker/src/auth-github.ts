import {
  GITHUB_AUTHORIZE_URL,
  GITHUB_OAUTH_SCOPES,
  GITHUB_TOKEN_URL,
  GITHUB_USER_URL,
} from './auth-limits';

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GithubUser {
  id: number;
  login: string;
  created_at: string;
  public_repos: number;
}

export function githubAuthorizeUrl(
  config: GithubOAuthConfig,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', GITHUB_OAUTH_SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGithubCode(
  config: GithubOAuthConfig,
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`github token exchange failed (${res.status})`);
  }
  const body = (await res.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!body.access_token) {
    throw new Error(body.error || 'github token missing');
  }
  return body.access_token;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'drop2.app',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`github user fetch failed (${res.status})`);
  }
  const body = (await res.json()) as {
    id?: number;
    login?: string;
    created_at?: string;
    public_repos?: number;
  };
  if (
    typeof body.id !== 'number' ||
    typeof body.login !== 'string' ||
    typeof body.created_at !== 'string' ||
    typeof body.public_repos !== 'number'
  ) {
    throw new Error('github user payload invalid');
  }
  return {
    id: body.id,
    login: body.login,
    created_at: body.created_at,
    public_repos: body.public_repos,
  };
}
