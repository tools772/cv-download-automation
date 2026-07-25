/**
 * Canonical Instahyre candidates URL — used by fetch agent (INSTAHYRE_CANDIDATES_URL).
 * Keep in sync with ats-perfect-ventures/src/utils/platformFetchUrls.ts
 */
export const INSTAHYRE_CANDIDATES_URL_EXAMPLE =
  'https://www.instahyre.com/employer/candidates/350351/0/';

export function isValidInstahyreCandidatesUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?instahyre\.com\/employer\/candidates\/\d+\/\d+/i.test(
    url.trim(),
  );
}
