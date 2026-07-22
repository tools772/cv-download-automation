import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  isAxiosError,
} from 'axios';
import type { AppConfig } from '../types/index.js';
import type { AuthenticatedClientOptions } from '../types/index.js';
import { loadCookiesFromStorage, cookiesToHeader, filterCookiesForUrl } from './cookies.js';
import { logger } from '../utils/logger.js';

const DEFAULT_RECRUITER_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://recruit.naukri.com/',
  Origin: 'https://recruit.naukri.com',
};

export class AuthenticatedApiClient {
  private axios: AxiosInstance;
  private cookiesCache: Awaited<ReturnType<typeof loadCookiesFromStorage>> = [];
  private config: AppConfig;
  private options: AuthenticatedClientOptions;

  constructor(config: AppConfig, options: AuthenticatedClientOptions = {}) {
    this.config = config;
    this.options = options;

    this.axios = axios.create({
      baseURL: options.baseURL ?? config.recruiterApiBaseUrl,
      timeout: 60_000,
      validateStatus: () => true,
      maxRedirects: 5,
    });

    this.axios.interceptors.request.use(async (req) => {
      await this.injectAuth(req);
      return req;
    });

    this.axios.interceptors.response.use(
      (res) => res,
      async (error) => {
        if (isAxiosError(error) && this.isSessionExpired(error.response)) {
          logger.warn('API session expired, triggering refresh handler');
          if (this.options.onSessionExpired) {
            await this.options.onSessionExpired();
            await this.refreshCookies();
            if (error.config) {
              return this.axios.request(error.config);
            }
          }
        }
        throw error;
      },
    );
  }

  private isSessionExpired(response?: AxiosResponse): boolean {
    if (!response) return false;
    if (response.status === 401 || response.status === 403) return true;
    const data = response.data;
    if (typeof data === 'string' && /login|session expired|unauthorized/i.test(data)) {
      return true;
    }
    if (data && typeof data === 'object') {
      const msg = JSON.stringify(data);
      if (/session.?expired|please.?login|unauthorized/i.test(msg)) return true;
    }
    return false;
  }

  async refreshCookies(): Promise<void> {
    this.cookiesCache = await loadCookiesFromStorage(this.config);
    logger.info('Cookie cache refreshed for API client', {
      count: this.cookiesCache.length,
    });
  }

  private async injectAuth(config: AxiosRequestConfig): Promise<void> {
    if (this.cookiesCache.length === 0) {
      await this.refreshCookies();
    }

    const requestUrl = config.url
      ? new URL(config.url, config.baseURL ?? this.config.recruiterApiBaseUrl).href
      : this.config.recruiterApiBaseUrl;

    const relevant = filterCookiesForUrl(this.cookiesCache, requestUrl);
    const cookieHeader = cookiesToHeader(relevant);

    config.headers = {
      ...DEFAULT_RECRUITER_HEADERS,
      ...config.headers,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };
  }

  async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  async request<T = unknown>(
    config: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const maxRetries = this.options.maxRetries ?? 2;
    let lastResponse: AxiosResponse<T> | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.axios.request<T>(config);
      lastResponse = response;

      if (!this.isSessionExpired(response)) {
        return response;
      }

      logger.warn('Session expired on API call', {
        url: config.url,
        status: response.status,
        attempt,
      });

      if (this.options.onSessionExpired) {
        await this.options.onSessionExpired();
        await this.refreshCookies();
        continue;
      }

      return response;
    }

    return lastResponse as AxiosResponse<T>;
  }
}

export async function createAuthenticatedClient(
  config: AppConfig,
  options?: AuthenticatedClientOptions,
): Promise<AuthenticatedApiClient> {
  const client = new AuthenticatedApiClient(config, options);
  await client.refreshCookies();
  return client;
}
