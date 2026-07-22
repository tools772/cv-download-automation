import { buildCandidateId } from './candidateId.js';
import {
  extractDownloadUrlsFromJson,
  looksLikeResumeDownloadUrl,
  pickBestDownloadUrl,
} from './downloadUrl.js';
import type { DiscoveredCandidate } from './types.js';
import { looksLikeCandidateProfileUrl } from './profileLinks.js';
import { buildV3PreviewUrl } from './srpInteraction.js';

interface RawCandidate {
  profileUrl?: string;
  downloadUrl?: string;
  candidateId?: string;
  candidateName?: string;
}

const PROFILE_KEYS = [
  'profileUrl',
  'profileLink',
  'previewUrl',
  'resumePreviewUrl',
  'candidateProfileUrl',
  'viewProfileUrl',
];

const NAME_KEYS = ['name', 'candidateName', 'userName', 'fullName', 'resumeTitle'];
const ID_KEYS = ['profileId', 'resumeId', 'resId', 'candId', 'candidateId', 'uniqId', 'userId', 'mnjUserId'];

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && !Number.isNaN(value)) return String(value);
  }
  return undefined;
}

function normalizeProfileUrl(value: string, base: string): string | undefined {
  try {
    const absolute = new URL(value, base).href;
    return looksLikeCandidateProfileUrl(absolute) ? absolute : undefined;
  } catch {
    return undefined;
  }
}

function parseCandidateObject(
  obj: Record<string, unknown>,
  baseUrl: string,
): RawCandidate | null {
  let profileUrl: string | undefined;
  for (const key of PROFILE_KEYS) {
    const value = obj[key];
    if (typeof value === 'string') {
      profileUrl = normalizeProfileUrl(value, baseUrl);
      if (profileUrl) break;
    }
  }

  const downloadCandidates = extractDownloadUrlsFromJson(obj);
  const downloadUrl = pickBestDownloadUrl(downloadCandidates.filter(looksLikeResumeDownloadUrl));

  const candidateId = pickString(obj, ID_KEYS);
  const candidateName = pickString(obj, NAME_KEYS);

  if (!profileUrl && !downloadUrl && !candidateId) return null;

  return { profileUrl, downloadUrl, candidateId, candidateName };
}

function walkJson(data: unknown, baseUrl: string, out: RawCandidate[]): void {
  if (!data || typeof data !== 'object') return;

  if (Array.isArray(data)) {
    for (const item of data) walkJson(item, baseUrl, out);
    return;
  }

  const parsed = parseCandidateObject(data as Record<string, unknown>, baseUrl);
  if (parsed) out.push(parsed);

  for (const value of Object.values(data)) {
    if (typeof value === 'object') walkJson(value, baseUrl, out);
  }
}

export function extractCandidatesFromSearchApi(
  jsonBodies: unknown[],
  searchUrl: string,
  limit: number,
): DiscoveredCandidate[] {
  const raw: RawCandidate[] = [];
  for (const body of jsonBodies) walkJson(body, searchUrl, raw);

  const discovered: DiscoveredCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length && discovered.length < limit; i++) {
    const item = raw[i]!;
    const key = item.profileUrl ?? item.downloadUrl ?? item.candidateId ?? `idx-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const candidateId =
      item.candidateId ??
      (item.profileUrl ? buildCandidateId(item.profileUrl, discovered.length + 1) : undefined);

    let profileUrl = item.profileUrl;
    if (!profileUrl && candidateId) {
      profileUrl = buildV3PreviewUrl(candidateId, searchUrl);
    }
    if (!profileUrl && !item.downloadUrl) continue;

    discovered.push({
      candidateId: candidateId ?? buildCandidateId(profileUrl!, discovered.length + 1),
      candidateName: item.candidateName,
      profileUrl: profileUrl!,
      downloadUrl: item.downloadUrl ?? '',
      discoveredAt: new Date().toISOString(),
      source: 'api-json',
    });
  }

  return discovered.filter((c) => c.downloadUrl || c.profileUrl);
}
