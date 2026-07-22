import type { AxiosResponse } from 'axios';
import type { AppConfig, ApiTestResult } from '../types/index.js';
import { AuthenticatedApiClient } from './client.js';
import { logger } from '../utils/logger.js';

/**
 * Known recruiter endpoints (may change; override via env or call sites).
 * These are used for smoke tests after login — not hardcoded session tokens.
 */
export const RECRUITER_ENDPOINTS = {
  homepage: '/mnr/homepage',
  dashboardMeta: '/mnr/api/recruiter/dashboard',
  userProfile: '/mnr/api/user/profile',
  sessionCheck: '/mnr/api/session',
} as const;

export class RecruiterApiService {
  constructor(
    private client: AuthenticatedApiClient,
    private config: AppConfig,
  ) {}

  async fetchDashboard(): Promise<AxiosResponse<unknown>> {
    return this.tryEndpoints([
      RECRUITER_ENDPOINTS.dashboardMeta,
      RECRUITER_ENDPOINTS.sessionCheck,
      RECRUITER_ENDPOINTS.homepage,
    ]);
  }

  async fetchUserProfile(): Promise<AxiosResponse<unknown>> {
    return this.client.get(RECRUITER_ENDPOINTS.userProfile);
  }

  private async tryEndpoints(
    paths: string[],
  ): Promise<AxiosResponse<unknown>> {
    let lastResponse: AxiosResponse<unknown> | undefined;

    for (const path of paths) {
      const response = await this.client.get(path, {
        headers: {
          Referer: `${this.config.recruiterBaseUrl}/mnr/homepage`,
        },
      });

      lastResponse = response;
      logger.info('Recruiter API probe', {
        path,
        status: response.status,
        size: getResponseSize(response),
      });

      if (response.status >= 200 && response.status < 400) {
        return response;
      }

      if (response.status !== 404) {
        return response;
      }
    }

    return lastResponse!;
  }

  async runDashboardSmokeTest(): Promise<ApiTestResult> {
    const response = await this.fetchDashboard();
    const responseSize = getResponseSize(response);
    const userInfo = extractUserInfo(response.data);

    return {
      status: response.status,
      responseSize,
      userInfo,
      raw: sanitizeForLog(response.data),
    };
  }
}

function getResponseSize(response: AxiosResponse<unknown>): number {
  if (response.data === undefined || response.data === null) return 0;
  if (typeof response.data === 'string') return response.data.length;
  try {
    return JSON.stringify(response.data).length;
  } catch {
    return 0;
  }
}

function extractUserInfo(
  data: unknown,
): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') {
    if (typeof data === 'string' && data.includes('<html')) {
      return { note: 'HTML response — session may still be valid in browser' };
    }
    return undefined;
  }

  const obj = data as Record<string, unknown>;
  const candidates = [
    obj.user,
    obj.recruiter,
    obj.profile,
    obj.data,
    obj.result,
  ];

  for (const c of candidates) {
    if (c && typeof c === 'object') {
      return c as Record<string, unknown>;
    }
  }

  const keys = ['email', 'userName', 'username', 'name', 'companyName', 'recruiterId'];
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) picked[key] = obj[key];
  }

  return Object.keys(picked).length > 0 ? picked : { keys: Object.keys(obj).slice(0, 20) };
}

function sanitizeForLog(data: unknown): unknown {
  if (typeof data === 'string') {
    return data.length > 500 ? `${data.slice(0, 500)}…` : data;
  }
  return data;
}

export async function createRecruiterApiService(
  config: AppConfig,
  options?: ConstructorParameters<typeof AuthenticatedApiClient>[1],
): Promise<RecruiterApiService> {
  const client = await import('./client.js').then((m) =>
    m.createAuthenticatedClient(config, options),
  );
  return new RecruiterApiService(client, config);
}
