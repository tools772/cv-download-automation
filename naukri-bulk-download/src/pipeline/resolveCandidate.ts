import type { AppConfig } from '../types/index.js';
import type { DiscoveredCandidate } from '../discovery/types.js';
import { discoverCandidates } from '../discovery/index.js';
import { ensureNaukriSession } from '../auth/naukri/service.js';
import { logger } from '../utils/logger.js';

export interface ResolvedTestCandidate {
  downloadUrl: string;
  candidateId: string;
  candidateName?: string;
  profileUrl?: string;
  source: 'manual' | 'discovery';
}

/**
 * Resolve which candidate to process:
 * - Manual: TEST_RESUME_DOWNLOAD_URL + TEST_CANDIDATE_ID
 * - Auto: RESDEX_SAVED_SEARCH_URL + DISCOVERY_LIMIT (default 1)
 */
export async function resolveTestCandidate(
  config: AppConfig,
): Promise<ResolvedTestCandidate> {
  if (config.testResumeDownloadUrl) {
    return {
      downloadUrl: config.testResumeDownloadUrl,
      candidateId: config.testCandidateId,
      source: 'manual',
    };
  }

  if (!config.resdexSavedSearchUrl) {
    throw new Error(
      'Set RESDEX_SAVED_SEARCH_URL for automatic discovery, or TEST_RESUME_DOWNLOAD_URL for manual mode.',
    );
  }

  const manager = await ensureNaukriSession(config);
  const context = manager.getContext();

  logger.info('Discovering candidates from saved search', {
    url: config.resdexSavedSearchUrl,
    limit: config.discoveryLimit,
  });

  const discovered = await discoverCandidates(
    config,
    context,
    config.discoveryLimit,
  );

  if (discovered.length === 0) {
    throw new Error(
      'Discovery found no candidates with download URLs. Open RESDEX_SAVED_SEARCH_URL in browser and verify results exist.',
    );
  }

  const first = discovered[0]!;
  logger.info('Using discovered candidate', {
    candidateId: first.candidateId,
    candidateName: first.candidateName,
    downloadUrl: first.downloadUrl,
  });

  return {
    downloadUrl: first.downloadUrl || first.profileUrl,
    candidateId: first.candidateId,
    candidateName: first.candidateName,
    profileUrl: first.profileUrl,
    source: 'discovery',
  };
}

export async function resolveDiscoveredBatch(
  config: AppConfig,
): Promise<DiscoveredCandidate[]> {
  if (!config.resdexSavedSearchUrl) {
    throw new Error('Set RESDEX_SAVED_SEARCH_URL');
  }
  const manager = await ensureNaukriSession(config);
  return discoverCandidates(config, manager.getContext(), config.discoveryLimit);
}
