const BROWSER_CLOSED_HINT =
  'Leave the Instahyre automation browser window open until the download finishes. ' +
  'Do not close it manually — closing it stops the fetch.';

export function isBrowserClosedMessage(message: string): boolean {
  return /target page, context or browser has been closed|browser tab closed|browser process disconnected/i.test(
    message,
  );
}

export function formatBrowserClosedError(step?: string): string {
  const where = step ? ` (${step})` : '';
  return `Instahyre download stopped: the automation browser was closed${where}. ${BROWSER_CLOSED_HINT}`;
}

export function formatCandidateListTimeout(url: string): string {
  return (
    `Instahyre candidate list did not load at ${url}. ` +
    'Confirm the URL is the job Candidates tab (…/employer/candidates/JOB_ID/0/) from Upload Resumes, ' +
    'not an old bookmark. Run: npm run login-instahyre'
  );
}

export function formatMissingCandidatesUrl(): string {
  return (
    'Missing Instahyre candidates URL. Paste the URL in Caliber Upload Resumes — ' +
    'the fetch agent uses that job URL, not INSTAHYRE_CANDIDATES_URL from .env.'
  );
}

export function formatPageBatchFailed(pageNumber: number, detail: string): string {
  if (isBrowserClosedMessage(detail)) {
    return formatBrowserClosedError(`page ${pageNumber}`);
  }
  if (/No "View profile" links/i.test(detail)) {
    return (
      `Instahyre page ${pageNumber}: candidate list UI not ready (no "View profile" links). ` +
      'Wait for the list to load, or check the candidates URL points to the correct job.'
    );
  }
  if (/Could not find "Select all"/i.test(detail) || /candidate checkboxes/i.test(detail)) {
    return (
      `Instahyre page ${pageNumber}: could not select candidates for bulk download. ` +
      `${detail} ${BROWSER_CLOSED_HINT}`
    );
  }
  return `Instahyre page ${pageNumber} failed: ${detail}`;
}

/** Turn noisy script output into a short message for fetch_jobs.error_message. */
export function extractInstahyreFailureSummary(output: string): string {
  const explicit = output
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter((l) => l.startsWith('INSTAHYRE ERROR:') || l.startsWith('INSTAHYRE FAILED:'));
  if (explicit.length > 0) {
    return explicit[explicit.length - 1]!.replace(/^INSTAHYRE (ERROR|FAILED):\s*/, '');
  }

  const pageFail = output.match(/\[page \d+\] status=failed \| (.+)/);
  if (pageFail?.[1]) {
    return pageFail[1].slice(0, 400);
  }

  if (isBrowserClosedMessage(output)) {
    return formatBrowserClosedError();
  }

  if (/Candidate list did not load within/i.test(output)) {
    const urlMatch = output.match(/\(https:\/\/[^\s)]+\)/);
    return formatCandidateListTimeout(urlMatch?.[0]?.slice(1, -1) ?? 'the candidates URL');
  }

  if (/Missing INSTAHYRE_CANDIDATES_URL|Missing Instahyre candidates URL/i.test(output)) {
    return formatMissingCandidatesUrl();
  }

  const lastLine = output
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter(Boolean)
    .pop();
  if (lastLine?.includes('Instahyre download failed:')) {
    return lastLine.replace(/^Instahyre download failed:\s*/, '').slice(0, 400);
  }

  return `Instahyre download failed. Check Fetch Agent logs. ${lastLine?.slice(0, 200) ?? ''}`.trim();
}

export function printInstahyreError(message: string): void {
  console.error(`\nINSTAHYRE ERROR: ${message}\n`);
}

export function printInstahyreWarning(message: string): void {
  console.warn(`INSTAHYRE WARNING: ${message}`);
}
