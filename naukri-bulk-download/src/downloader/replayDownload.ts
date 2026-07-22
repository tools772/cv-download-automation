import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import fs from 'fs-extra';
import axios, { type AxiosResponse } from 'axios';
import type { BrowserContext } from 'playwright';
import type { AppConfig } from '../types/index.js';
import { cookiesToHeader, loadNaukriCookies } from '../api/cookies.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { sha256File } from '../utils/hash.js';
import { detectResumeFormat, isHtmlResponse } from './validators.js';
import type { InterceptedResumeRequest } from './interceptResumeDownload.js';

export interface ReplayDownloadResult {
  localPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Replays the intercepted browser request with axios (streaming).
 * Uses cookies from Playwright context + headers captured from the real request.
 */
export async function replayResumeDownload(
  config: AppConfig,
  intercepted: InterceptedResumeRequest,
  context: BrowserContext,
  destPath: string,
  options?: { onSessionExpired?: () => Promise<void> },
): Promise<ReplayDownloadResult> {
  const started = Date.now();
  logger.info('Replay download started', {
    urlPreview: intercepted.url.slice(0, 160),
    method: intercepted.method,
  });

  const contextCookies = await context.cookies();
  const storageCookies = await loadNaukriCookies(config);
  const cookies = contextCookies.length > 0 ? contextCookies : storageCookies;
  const cookieHeader = cookiesToHeader(cookies, intercepted.url);

  const headers: Record<string, string> = {
    ...sanitizeReplayHeaders(intercepted.headers),
    Cookie: cookieHeader || intercepted.headers.cookie || intercepted.headers.Cookie || '',
    Referer: intercepted.headers.referer ?? intercepted.headers.Referer ?? 'https://resdex.naukri.com/',
    Accept: '*/*',
  };

  if (!headers['User-Agent'] && !headers['user-agent']) {
    headers['User-Agent'] =
      intercepted.headers['user-agent'] ??
      intercepted.headers['User-Agent'] ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  const execute = async (): Promise<ReplayDownloadResult> => {
    const response: AxiosResponse<NodeJS.ReadableStream> = await axios.request({
      url: intercepted.url,
      method: intercepted.method as 'GET' | 'POST',
      headers,
      data: intercepted.postData,
      responseType: 'stream',
      timeout: 120_000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    await pipeline(response.data, createWriteStream(destPath));

    const buffer = await readFileHead(destPath, 8192);
    if (isHtmlResponse(buffer)) {
      throw new Error(
        'Replay returned HTML (session expired, captcha, or invalid intercept). Re-login and retry.',
      );
    }

    const format = detectResumeFormat(buffer);
    if (!format.valid) {
      throw new Error('Replay response is not a valid PDF/DOC/DOCX resume');
    }

    const contentType = response.headers['content-type'] as string | undefined;
    const mimeType =
      format.mimeType ||
      contentType?.split(';')[0]?.trim() ||
      'application/octet-stream';
    const stat = await fs.stat(destPath);
    const sha256 = await sha256File(destPath);

    logger.info('Replay download completed', {
      mimeType,
      sizeBytes: stat.size,
      durationMs: Date.now() - started,
      sha256: sha256.slice(0, 12),
    });

    return {
      localPath: destPath,
      fileName: path.basename(destPath),
      mimeType,
      sizeBytes: stat.size,
      sha256,
    };
  };

  try {
    return await withRetry(execute, {
      label: 'replay-resume-download',
      maxAttempts: config.downloadMaxRetries,
      retryOn: (err, status) => {
        if (status === 401 || status === 403 || status === 429) return true;
        const msg = err instanceof Error ? err.message : String(err);
        return /HTML|session|captcha|401|403/i.test(msg);
      },
    });
  } catch (error) {
    if (options?.onSessionExpired) {
      logger.warn('Replay failed — refreshing session');
      await options.onSessionExpired();
      return replayResumeDownload(config, intercepted, context, destPath);
    }
    throw error;
  }
}

function sanitizeReplayHeaders(
  raw: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'cookie',
  ]);

  for (const [key, value] of Object.entries(raw)) {
    if (skip.has(key.toLowerCase())) continue;
    if (value) out[key] = value;
  }
  return out;
}

async function readFileHead(filePath: string, bytes: number): Promise<Buffer> {
  const fs = await import('fs-extra');
  const fd = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await fs.read(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fs.close(fd);
  }
}
