const ID_PARAM_KEYS = [
  'profileId',
  'resumeId',
  'resId',
  'resid',
  'uname',
  'candId',
  'candidateId',
  'uniqId',
  'userId',
  'id',
];

export function extractCandidateIdFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    for (const key of ID_PARAM_KEYS) {
      const value = parsed.searchParams.get(key);
      if (value?.trim()) return value.trim();
    }
    const pathMatch = parsed.pathname.match(
      /\/(?:profile|candidate|resume|preview)\/([^/?#]+)/i,
    );
    if (pathMatch?.[1]) return pathMatch[1];
  } catch {
    // ignore
  }
  return undefined;
}

export function buildCandidateId(profileUrl: string, index: number): string {
  return extractCandidateIdFromUrl(profileUrl) ?? `candidate-${String(index).padStart(3, '0')}`;
}
