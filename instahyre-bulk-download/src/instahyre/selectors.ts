/** Instahyre employer candidate list — bulk download UI */

export const INSTAHYRE_URLS = {
  login: 'https://www.instahyre.com/login/',
  employerHome: 'https://www.instahyre.com/employer/',
} as const;

export const CANDIDATE_LIST = {
  selectAll: [
    'label:has-text("Select all") input[type="checkbox"]',
    'text=Select all >> .. >> input[type="checkbox"]',
    'input[type="checkbox"]:near(:text("Select all"))',
  ],
  /** Per-candidate checkboxes in the list (excludes Select all / modal). */
  profileCheckbox: [
    '.candidate-card input[type="checkbox"]',
    '.candidate-list input[type="checkbox"]',
    'tr.candidate input[type="checkbox"]',
    '[class*="candidate"] input[type="checkbox"]',
  ],
  downloadResumes: [
    'a:has-text("Download resumes")',
    'button:has-text("Download resumes")',
    '[role="button"]:has-text("Download resumes")',
    'text=/Download resumes/i',
  ],
  resultsSummary: /Showing\s+\d+\s*-\s*\d+\s+of\s+(\d+)\s+results/i,
  nextPage: [
    'a:has-text("Next")',
    'a:has-text("Next »")',
    'a:has-text("Next ›")',
    '.pagination a:has-text("Next")',
  ],
} as const;

export const DOWNLOAD_MODAL = {
  title: /Download\s+\d+\s+resumes?/i,
  zipCheckbox: [
    'label:has-text("Zip file of resumes") input[type="checkbox"]',
    'text=Zip file of resumes >> .. >> input[type="checkbox"]',
    'input[type="checkbox"]:near(:text("Zip file of resumes"))',
  ],
  downloadButton: [
    'button:has-text("Download"):not(:has-text("Download resumes"))',
    '.modal button:has-text("Download")',
    '[role="dialog"] button:has-text("Download")',
  ],
  cancelButton: 'button:has-text("Cancel")',
} as const;

/** Candidate profile slide-out / modal (View profile → Download resume). */
export const CANDIDATE_PROFILE = {
  viewProfile: [
    'a:has-text("View profile")',
    'button:has-text("View profile")',
    'text=/View profile/i',
  ],
  downloadResume: [
    'a:has-text("Download resume")',
    'button:has-text("Download resume")',
    'text=/Download resume/i',
  ],
  close: [
    'button[aria-label="Close"]',
    'button:has-text("Close")',
    '[class*="close"] button',
    '.modal-header button.close',
  ],
  resumeTab: [/^\s*Resume\s*$/i, 'text=Resume'],
} as const;

export const LOGIN = {
  email: [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="email" i]',
  ],
  password: ['input[type="password"]', 'input[name="password"]'],
  submit: [
    'button[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'input[type="submit"]',
  ],
} as const;
