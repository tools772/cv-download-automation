export function isHtmlResponse(buffer: Buffer): boolean {
  const head = buffer.slice(0, 512).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<body');
}

export function detectResumeFormat(buffer: Buffer): {
  valid: boolean;
  mimeType: string;
  extension: string;
} {
  if (buffer.length < 8) {
    return { valid: false, mimeType: 'application/octet-stream', extension: 'bin' };
  }

  const sig4 = buffer.slice(0, 4).toString('latin1');
  if (sig4 === '%PDF') {
    return { valid: true, mimeType: 'application/pdf', extension: 'pdf' };
  }

  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return {
      valid: true,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }

  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return { valid: true, mimeType: 'application/msword', extension: 'doc' };
  }

  return { valid: false, mimeType: 'application/octet-stream', extension: 'bin' };
}

export function extensionFromContentType(contentType?: string): string | null {
  if (!contentType) return null;
  const ct = contentType.split(';')[0]?.trim().toLowerCase();
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
  };
  return map[ct] ?? null;
}
