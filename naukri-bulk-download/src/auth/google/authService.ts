import { google } from 'googleapis';
import type { AppConfig } from '../../types/index.js';
import { assertGoogleOAuthConfig } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { waitForOAuthCallback } from './oauthServer.js';
import { loadGoogleTokens, saveGoogleTokens, googleTokensExist } from './tokenStore.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function buildGoogleAuthUrl(config: AppConfig): string {
  const oauth2 = createOAuth2Client(config);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [DRIVE_SCOPE],
  });
}

function createOAuth2Client(config: AppConfig) {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

export async function runGoogleOAuthFlow(config: AppConfig): Promise<string> {
  assertGoogleOAuthConfig(config);
  const oauth2 = createOAuth2Client(config);
  const authUrl = buildGoogleAuthUrl(config);

  console.log('\nOpen this URL and approve Drive access:\n');
  console.log(authUrl);
  console.log('\nWaiting for callback...\n');

  const code = await waitForOAuthCallback(config.googleRedirectUri);
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. Revoke app access in Google Account and re-run auth:google.',
    );
  }

  await saveGoogleTokens(config, {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
  });

  return config.googleTokenFile;
}

export async function getAuthorizedOAuth2Client(config: AppConfig) {
  assertGoogleOAuthConfig(config);

  if (!(await googleTokensExist(config))) {
    throw new Error('Google tokens missing. Run: npm run auth:google');
  }

  const oauth2 = createOAuth2Client(config);
  const stored = await loadGoogleTokens(config);
  if (!stored?.refresh_token && !stored?.access_token) {
    throw new Error('Invalid Google token file. Run: npm run auth:google');
  }

  oauth2.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: stored.expiry_date,
    scope: stored.scope,
    token_type: stored.token_type,
  });

  oauth2.on('tokens', async (tokens) => {
    if (!tokens.access_token) return;
    logger.info('Google access token refreshed');
    await saveGoogleTokens(config, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? stored.refresh_token,
      expiry_date: tokens.expiry_date ?? stored.expiry_date,
      scope: tokens.scope ?? stored.scope,
      token_type: tokens.token_type ?? stored.token_type,
    });
  });

  return oauth2;
}

export async function ensureGoogleAuth(config: AppConfig): Promise<void> {
  await getAuthorizedOAuth2Client(config);
}
