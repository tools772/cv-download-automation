import type { Browser, BrowserContext, Cookie, Page } from 'playwright';

export interface AppConfig {
  username: string;
  password: string;
  headless: boolean;
  mobileEmulation: boolean;
  proxyServer?: string;
  sessionDir: string;
  storageStateFile: string;
  loginTimeoutMs: number;
  sessionValidateTimeoutMs: number;
  recruiterBaseUrl: string;
  recruiterApiBaseUrl: string;
  resdexSavedSearchUrl?: string;
  downloadLimit: number;
  googleDriveFolderId?: string;
  downloadStartRank?: number; // 1-based, default 1
  downloadEndRank?: number;
  /** Upload each saved local file to Drive after download completes. */
  uploadToDriveAfterDownload: boolean;
  googleAuthMode: 'service_account' | 'oauth';
  googleServiceAccountFile?: string;
  googleServiceAccountJson?: string;
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthClientFile?: string;
  googleOAuthClientJson?: string;
  googleOAuthRedirectUri: string;
  googleOAuthTokenFile: string;
  enableHarExport: boolean;
  enableNetworkLogging: boolean;
  logLevel: string;
  /** When true: click Download CV, save captures to localSaveDir, press ENTER between candidates. */
  manualDownloadSave: boolean;
  /** Folder for captured CV files (set LOCAL_SAVE_DIR in .env). */
  localSaveDir?: string;
  /** @deprecated Use wait-for-ENTER flow; kept for compatibility. */
  manualDownloadPauseMs: number;
  /** When true, login is done manually (companion agent); credentials not required if session exists. */
  manualResdexLogin: boolean;
}

export interface LoginSelectors {
  /** naukri.com/recruit/login — "Register/Log in" tab */
  registerLoginTab: string[];
  username: string[];
  password: string[];
  submit: string[];
  captcha: string[];
  errorMessage: string[];
  termsCheckbox: string[];
}

export interface SessionMetadata {
  savedAt: string;
  username: string;
  loginUrl: string;
  dashboardUrl?: string;
  userAgent: string;
  expiresAt?: string;
}

export interface PersistedSession {
  storageStatePath: string;
  metadata: SessionMetadata;
  cookies: Cookie[];
}

export interface LoginResult {
  success: boolean;
  page: Page;
  context: BrowserContext;
  browser: Browser;
  dashboardUrl?: string;
  error?: LoginError;
}

export type LoginErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'CAPTCHA_DETECTED'
  | 'LOGIN_TIMEOUT'
  | 'BLOCKED_SESSION'
  | 'REDIRECT_LOOP'
  | 'UNKNOWN';

export interface LoginError {
  code: LoginErrorCode;
  message: string;
  screenshotPath?: string;
}

export interface SessionValidationResult {
  valid: boolean;
  reason?: string;
  redirectedToLogin?: boolean;
}

export interface ApiTestResult {
  status: number;
  responseSize: number;
  userInfo?: Record<string, unknown>;
  raw?: unknown;
}

export interface AuthenticatedClientOptions {
  baseURL?: string;
  maxRetries?: number;
  onSessionExpired?: () => Promise<void>;
}

export interface BrowserLaunchOptions {
  headless?: boolean;
  mobileEmulation?: boolean;
  proxyServer?: string;
  recordHar?: boolean;
  harPath?: string;
}

export interface StorageSnapshot {
  localStorage: Record<string, Record<string, string>>;
  sessionStorage: Record<string, Record<string, string>>;
}
