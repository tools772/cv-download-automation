export interface InstahyreConfig {
  email: string;
  password: string;
  headless: boolean;
  /** When true, user signs in via visible browser instead of INSTAHYRE_EMAIL/PASSWORD auto-fill. */
  manualLogin: boolean;
  manualLoginTimeoutMs: number;
  sessionDir: string;
  storageStateFile: string;
  loginTimeoutMs: number;
  sessionValidateTimeoutMs: number;
  /** Employer candidates list URL, e.g. https://www.instahyre.com/employer/candidates/350351/0/ */
  instahyreCandidatesUrl?: string;
  downloadLimit: number;
  localSaveDir: string;
  uploadToDriveAfterDownload: boolean;
  googleDriveFolderId?: string;
  googleAuthMode: 'service_account' | 'oauth';
  googleServiceAccountFile?: string;
  googleServiceAccountJson?: string;
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthClientFile?: string;
  googleOAuthClientJson?: string;
  googleOAuthRedirectUri: string;
  googleOAuthTokenFile: string;
  logLevel: string;
}

export interface BrowserLaunchOptions {
  headless?: boolean;
  storageStatePath?: string;
}
