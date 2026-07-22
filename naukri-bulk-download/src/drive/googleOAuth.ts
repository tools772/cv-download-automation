import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';

interface OAuthClientFile {
  web?: OAuthClientConfig;
  installed?: OAuthClientConfig;
}

interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  token_uri?: string;
  auth_uri?: string;
  redirect_uris?: string[];
}

interface OAuthTokenFile {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  token_type?: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';

async function loadOAuthClient(config: AppConfig): Promise<OAuthClientConfig> {
  if (config.googleOAuthClientId && config.googleOAuthClientSecret) {
    return {
      client_id: config.googleOAuthClientId,
      client_secret: config.googleOAuthClientSecret,
      auth_uri: GOOGLE_AUTH_URI,
      token_uri: GOOGLE_TOKEN_URI,
      redirect_uris: [config.googleOAuthRedirectUri],
    };
  }

  if (config.googleOAuthClientJson) {
    return normalizeClientConfig(
      JSON.parse(config.googleOAuthClientJson) as OAuthClientFile,
    );
  }

  if (config.googleOAuthClientFile) {
    const raw = await fs.readFile(config.googleOAuthClientFile, 'utf8');
    return normalizeClientConfig(JSON.parse(raw) as OAuthClientFile);
  }

  throw new Error(
    'Missing OAuth client. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, or set GOOGLE_OAUTH_CLIENT_FILE/GOOGLE_OAUTH_CLIENT_JSON.',
  );
}

function normalizeClientConfig(file: OAuthClientFile): OAuthClientConfig {
  const client = file.web ?? file.installed;
  if (!client?.client_id || !client.client_secret) {
    throw new Error(
      'Invalid OAuth client file. Expected web.client_id/client_secret or installed.client_id/client_secret.',
    );
  }
  return client;
}

export function buildGoogleOAuthUrl(
  client: OAuthClientConfig,
  redirectUri: string,
): string {
  const url = new URL(client.auth_uri ?? GOOGLE_AUTH_URI);
  url.searchParams.set('client_id', client.client_id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.href;
}

export async function runGoogleOAuthSetup(config: AppConfig): Promise<string> {
  const client = await loadOAuthClient(config);
  const redirectUri = config.googleOAuthRedirectUri;
  const authUrl = buildGoogleOAuthUrl(client, redirectUri);

  console.log('\nOpen this URL in your browser and approve Drive access:\n');
  console.log(authUrl);
  console.log('\nWaiting for Google redirect...');

  const code = await waitForOAuthCode(redirectUri);
  const token = await exchangeCodeForToken(config, client, code);

  if (!token.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Re-run setup; the URL uses prompt=consent and access_type=offline.',
    );
  }

  await saveToken(config, token);
  return config.googleOAuthTokenFile;
}

export async function getOAuthAccessToken(config: AppConfig): Promise<string> {
  const token = await loadToken(config);
  const now = Date.now();

  if (token.access_token && token.expires_at && token.expires_at - 60_000 > now) {
    return token.access_token;
  }

  if (!token.refresh_token) {
    throw new Error(
      `Missing Google OAuth refresh token. Run: npm run google-oauth-setup`,
    );
  }

  const client = await loadOAuthClient(config);
  const refreshed = await refreshAccessToken(client, token.refresh_token);
  const merged = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? token.refresh_token,
  };
  await saveToken(config, merged);

  if (!merged.access_token) {
    throw new Error('Google OAuth refresh did not return an access token.');
  }

  return merged.access_token;
}

async function waitForOAuthCode(redirectUri: string): Promise<string> {
  const url = new URL(redirectUri);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const pathname = url.pathname;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', redirectUri);
        if (requestUrl.pathname !== pathname) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`OAuth failed: ${error}`);
          server.close();
          reject(new Error(`Google OAuth failed: ${error}`));
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Google Drive access granted. You can close this tab.');
        server.close();
        resolve(code);
      } catch (error) {
        server.close();
        reject(error);
      }
    });

    server.once('error', reject);
    server.listen(port, url.hostname);
  });
}

async function exchangeCodeForToken(
  config: AppConfig,
  client: OAuthClientConfig,
  code: string,
): Promise<OAuthTokenFile> {
  return postTokenRequest(client.token_uri ?? GOOGLE_TOKEN_URI, {
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: config.googleOAuthRedirectUri,
    grant_type: 'authorization_code',
  });
}

async function refreshAccessToken(
  client: OAuthClientConfig,
  refreshToken: string,
): Promise<OAuthTokenFile> {
  return postTokenRequest(client.token_uri ?? GOOGLE_TOKEN_URI, {
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

async function postTokenRequest(
  tokenUri: string,
  params: Record<string, string>,
): Promise<OAuthTokenFile> {
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

  const data = (await response.json()) as OAuthTokenFile & {
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.error_description || data.error || 'Google OAuth token request failed',
    );
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
    token_type: data.token_type,
  };
}

async function loadToken(config: AppConfig): Promise<OAuthTokenFile> {
  if (!(await fs.pathExists(config.googleOAuthTokenFile))) {
    return {};
  }
  return (await fs.readJson(config.googleOAuthTokenFile)) as OAuthTokenFile;
}

async function saveToken(
  config: AppConfig,
  token: OAuthTokenFile,
): Promise<void> {
  await fs.ensureDir(path.dirname(config.googleOAuthTokenFile));
  await fs.writeJson(config.googleOAuthTokenFile, token, { spaces: 2 });
}
