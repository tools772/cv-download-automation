import type { LoginSelectors } from '../types/index.js';

export const LOGIN_SELECTORS: LoginSelectors = {
  registerLoginTab: [
    '[role="tab"]:has-text("Register/Log in")',
    'button:has-text("Register/Log in")',
    'text=Register/Log in',
  ],
  username: [
    'input[placeholder="Enter registered email ID"]',
    'input[placeholder*="registered email" i]',
    'getByPlaceholder:Enter registered email ID',
    'input[type="email"]',
    'input[name="email"]',
  ],
  password: [
    'input[placeholder="Enter password"]',
    'getByPlaceholder:Enter password',
    'input[type="password"]',
    'input[name="password"]',
  ],
  submit: [
    'button:has-text("Log in")',
    'getByRole:button|Log in',
    'button[type="submit"]',
  ],
  captcha: [
    'iframe[src*="captcha" i]',
    'iframe[src*="recaptcha" i]',
    '.g-recaptcha',
    'text=Verify you are human',
  ],
  errorMessage: [
    '[role="alert"]',
    '.error-msg',
    'text=Incorrect username or password',
    'text=invalid email',
  ],
  termsCheckbox: [
    'label:has-text("Terms") input[type="checkbox"]',
    'input[type="checkbox"][name*="terms" i]',
  ],
};

export const LOGIN_PLACEHOLDERS = {
  email: 'Enter registered email ID',
  password: 'Enter password',
} as const;

export const NAUKRI_URLS = {
  login: 'https://www.naukri.com/recruit/login',
  sessionValidate: 'https://recruit.naukri.com/mnr/homepage',
} as const;

export const LOGIN_SUCCESS_PATTERNS = [
  /recruit\.naukri\.com(?!.*\/recruit\/login)/i,
  /mnr\/homepage/i,
  /mnr\//i,
] as const;

export const LOGIN_FAILURE_URL_PATTERNS = [
  /login\.recruit\.naukri\.com/i,
  /RPAuthenticate/i,
] as const;
