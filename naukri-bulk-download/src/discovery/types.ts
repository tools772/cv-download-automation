export interface DiscoveredCandidate {
  candidateId: string;
  candidateName?: string;
  profileUrl: string;
  downloadUrl: string;
  discoveredAt: string;
  source: 'network' | 'dom' | 'api-json';
}
