import axios, { type AxiosInstance, isAxiosError } from 'axios';
import type { AppConfig } from '../types/index.js';
import { cookiesToHeader, loadNaukriCookies } from './cookies.js';
import { logger } from '../utils/logger.js';

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://recruit.naukri.com/',
  Origin: 'https://recruit.naukri.com',
};

export class NaukriApiClient {
  private axios: AxiosInstance;
  private cookies: Awaited<ReturnType<typeof loadNaukriCookies>> = [];
  private onSessionExpired?: () => Promise<void>;

  constructor(
    private config: AppConfig,
    options?: { onSessionExpired?: () => Promise<void> },
  ) {
    this.onSessionExpired = options?.onSessionExpired;
    this.axios = axios.create({
      baseURL: config.recruiterApiBaseUrl,
      timeout: 120_000,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'arraybuffer',
    });

    this.axios.interceptors.request.use(async (req) => {
      await this.injectCookies(req);
      return req;
    });
  }

  async refreshCookies(): Promise<void> {
    this.cookies = await loadNaukriCookies(this.config);
    logger.info('Naukri cookies loaded', { count: this.cookies.length });
  }

  private async injectCookies(req: { url?: string; baseURL?: string; headers?: Record<string, unknown> }): Promise<void> {
    if (this.cookies.length === 0) await this.refreshCookies();
    const url = req.url
      ? new URL(req.url, req.baseURL ?? this.config.recruiterApiBaseUrl).href
      : this.config.recruiterApiBaseUrl;
    const cookieHeader = cookiesToHeader(this.cookies, url);
    req.headers = {
      ...DEFAULT_HEADERS,
      ...req.headers,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };
  }

  private isAuthFailure(status: number, data: Buffer): boolean {
    if (status === 401 || status === 403) return true;
    const text = data.slice(0, 500).toString('utf8');
    return /<html|login|session expired|captcha/i.test(text);
  }

  async downloadBinary(url: string): Promise<{ data: Buffer; headers: Record<string, string>; status: number }> {
    const absolute = url.startsWith('http') ? url : new URL(url, this.config.recruiterApiBaseUrl).href;
    const response = await this.axios.get(absolute, { responseType: 'arraybuffer' });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }

    const data = Buffer.from(response.data);

    if (this.isAuthFailure(response.status, data)) {
      logger.warn('Naukri API auth failure', { status: response.status, url: absolute });
      if (this.onSessionExpired) {
        await this.onSessionExpired();
        await this.refreshCookies();
        const retry = await this.axios.get(absolute, { responseType: 'arraybuffer' });
        return {
          data: Buffer.from(retry.data),
          headers: Object.fromEntries(
            Object.entries(retry.headers).filter(([, v]) => typeof v === 'string'),
          ) as Record<string, string>,
          status: retry.status,
        };
      }
    }

    return { data, headers, status: response.status };
  }
}

export async function createNaukriApiClient(
  config: AppConfig,
  options?: { onSessionExpired?: () => Promise<void> },
): Promise<NaukriApiClient> {
  const client = new NaukriApiClient(config, options);
  await client.refreshCookies();
  return client;
}

export function isAxiosRateLimit(error: unknown): boolean {
  return isAxiosError(error) && (error.response?.status === 429 || error.response?.status === 503);
}
