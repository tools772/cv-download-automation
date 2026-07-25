import crypto from 'node:crypto';
import fs from 'fs-extra';
import type { InstahyreConfig } from '../types/index.js';
import { getOAuthAccessToken } from './googleOAuth.js';
import { logger } from '../utils/logger.js';

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface DriveUploadResult {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function loadServiceAccount(
  config: InstahyreConfig,
): Promise<ServiceAccountCredentials> {
  if (config.googleServiceAccountJson) {
    return JSON.parse(config.googleServiceAccountJson) as ServiceAccountCredentials;
  }

  if (config.googleServiceAccountFile) {
    const raw = await fs.readFile(config.googleServiceAccountFile, 'utf8');
    return JSON.parse(raw) as ServiceAccountCredentials;
  }

  throw new Error(
    'Missing Google service account. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE.',
  );
}

async function getAccessToken(config: InstahyreConfig): Promise<string> {
  const injected = process.env.GOOGLE_DRIVE_ACCESS_TOKEN?.trim();
  if (injected) {
    return injected;
  }

  if (config.googleAuthMode === 'oauth') {
    return getOAuthAccessToken(config);
  }

  const credentials = await loadServiceAccount(config);
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const claim = {
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(claim),
  )}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.private_key.replace(/\\n/g, '\n'));
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(claim.aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || 'Failed to authenticate Google Drive',
    );
  }

  return data.access_token;
}

function guessMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}

async function findFileInFolderByName(
  accessToken: string,
  folderId: string,
  fileName: string,
): Promise<DriveUploadResult | null> {
  const escaped = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${escaped}' and '${folderId}' in parents and trashed=false`,
  );
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink,webContentLink)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const data = (await response.json()) as {
    files?: DriveUploadResult[];
    error?: { message?: string };
  };
  if (!response.ok) return null;
  return data.files?.[0] ?? null;
}

export async function uploadFileToDrive(
  config: InstahyreConfig,
  filePath: string,
  fileName: string,
): Promise<DriveUploadResult> {
  if (!config.googleDriveFolderId) {
    throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID.');
  }

  const accessToken = await getAccessToken(config);

  const existing = await findFileInFolderByName(
    accessToken,
    config.googleDriveFolderId,
    fileName,
  );
  if (existing?.id) {
    logger.info('Drive file already exists — skipping re-upload', {
      fileName,
      driveFileId: existing.id,
    });
    return existing;
  }

  const fileBuffer = await fs.readFile(filePath);
  const mimeType = guessMimeType(fileName);
  const boundary = `pv-${crypto.randomUUID()}`;
  const metadata = {
    name: fileName,
    parents: [config.googleDriveFolderId],
  };

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata,
      )}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body: body as unknown as BodyInit,
    },
  );

  const data = (await response.json()) as DriveUploadResult & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to upload file to Drive');
  }

  return data;
}
