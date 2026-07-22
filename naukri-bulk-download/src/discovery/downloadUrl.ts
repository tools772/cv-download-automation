const DOWNLOAD_URL_PATTERNS = [
  /downloadresume/i,
  /downloadcv/i,
  /download.*resume/i,
  /download.*cv/i,
  /\/download\//i,
  /getresume/i,
  /getcv/i,
  /fetchcv/i,
  /cvattached/i,
  /attachment/i,
  /viewcv/i,
  /viewresume/i,
  /resumedownload/i,
  /cvdocument/i,
];

const EXCLUDE_URL_PATTERNS = [
  /\.js(\?|$)/i,
  /\.css(\?|$)/i,
  /analytics/i,
  /google-analytics/i,
  /hotjar/i,
];

export function looksLikeResumeDownloadUrl(url: string): boolean {
  if (!url.startsWith('http')) return false;
  if (EXCLUDE_URL_PATTERNS.some((p) => p.test(url))) return false;
  return DOWNLOAD_URL_PATTERNS.some((p) => p.test(url));
}

export function extractDownloadUrlsFromJson(
  data: unknown,
  found: string[] = [],
): string[] {
  if (!data || typeof data !== 'object') return found;

  if (Array.isArray(data)) {
    for (const item of data) extractDownloadUrlsFromJson(item, found);
    return found;
  }

  const obj = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.trim()) {
      const v = value.trim();
      if (looksLikeResumeDownloadUrl(v)) {
        found.push(v);
      } else if (
        v.startsWith('/') &&
        /download|resume|cv/i.test(v)
      ) {
        found.push(`https://resdex.naukri.com${v}`);
      } else if (
        /^https?:\/\//i.test(v) &&
        /download|resume|cv|attachment|fileUrl|document|cvUrl/i.test(key)
      ) {
        found.push(v);
      }
    } else if (typeof value === 'object') {
      extractDownloadUrlsFromJson(value, found);
    }
  }

  return found;
}

export function pickBestDownloadUrl(urls: string[]): string | undefined {
  const unique = [...new Set(urls)];
  const scored = unique.map((url) => {
    let score = 0;
    if (/download/i.test(url)) score += 3;
    if (/resume|cv/i.test(url)) score += 2;
    if (/resdex|recruit\.naukri/i.test(url)) score += 2;
    if (/\.pdf/i.test(url)) score += 1;
    return { url, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.url;
}
