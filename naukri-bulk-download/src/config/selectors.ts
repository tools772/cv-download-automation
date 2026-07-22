import type { LoginSelectors } from '../types/index.js';

/**
 * Selectors for https://www.naukri.com/recruit/login
 * "Register/Log in" tab → email + password → "Log in" button.
 * Chains are tried in order (first visible match wins).
 */
export const LOGIN_SELECTORS: LoginSelectors = {
  registerLoginTab: [
    '[role="tab"]:has-text("Register/Log in")',
    'button:has-text("Register/Log in")',
    'div[role="tab"]:has-text("Register")',
    'text=Register/Log in',
  ],
  username: [
    'input[placeholder="Enter registered email ID"]',
    'input[placeholder*="registered email" i]',
    'input[placeholder*="email ID" i]',
    'getByPlaceholder:Enter registered email ID',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[autocomplete="username"]',
  ],
  password: [
    'input[placeholder="Enter password"]',
    'input[placeholder*="Enter password" i]',
    'getByPlaceholder:Enter password',
    'input[type="password"]',
    'input[name="password"]',
    'input[autocomplete="current-password"]',
  ],
  submit: [
    'button:has-text("Log in")',
    'button >> text=/^Log in$/i',
    '[role="button"]:has-text("Log in")',
    'button[type="submit"]:has-text("Log in")',
    'button[type="submit"]',
    'input[type="submit"]',
  ],
  captcha: [
    'iframe[src*="captcha" i]',
    'iframe[src*="recaptcha" i]',
    '.g-recaptcha',
    '#captcha',
    '[class*="captcha" i]',
    'text=Verify you are human',
    'text=complete the security check',
  ],
  errorMessage: [
    '[role="alert"]',
    '.error-msg',
    '.login-error',
    '.err-msg',
    '[class*="error" i]:visible',
    'text=Incorrect username or password',
    'text=Invalid credentials',
    'text=wrong password',
    'text=invalid email',
    'text=incorrect password',
  ],
  termsCheckbox: [
    'input[type="checkbox"][name*="terms" i]',
    'input[type="checkbox"][id*="terms" i]',
    'label:has-text("Terms") input[type="checkbox"]',
    'label:has-text("Conditions") input[type="checkbox"]',
  ],
};

/** Playwright getByPlaceholder names (recruit/login form). */
export const LOGIN_PLACEHOLDERS = {
  email: 'Enter registered email ID',
  password: 'Enter password',
} as const;

export const URLS = {
  login: 'https://www.naukri.com/recruit/login',
  loginAlt: 'https://login.recruit.naukri.com/Login/RPAuthenticate',
  dashboard: 'https://recruit.naukri.com',
  dashboardHome: 'https://recruit.naukri.com/mnr/homepage',
  sessionValidate: 'https://recruit.naukri.com/mnr/homepage',
} as const;

export const LOGIN_SUCCESS_PATTERNS = [
  /recruit\.naukri\.com(?!.*\/recruit\/login)/i,
  /mnr\/homepage/i,
  /mnr\//i,
  /talentcloud/i,
  /employer/i,
] as const;

/** Auth failure redirects — exclude naukri.com/recruit/login (the form page). */
export const LOGIN_FAILURE_URL_PATTERNS = [
  /login\.recruit\.naukri\.com/i,
  /RPAuthenticate/i,
  /\/authenticate/i,
] as const;
