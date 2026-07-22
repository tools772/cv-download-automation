import { detectResumeFormat, extensionFromContentType } from './validators.js';

export function resolveResumeFileInfo(
  buffer: Buffer,
  contentType?: string,
  suggestedName?: string,
): { mimeType: string; extension: string } {
  const fromBuffer = detectResumeFormat(buffer);
  if (fromBuffer.valid) {
    return { mimeType: fromBuffer.mimeType, extension: fromBuffer.extension };
  }

  const fromHeader = extensionFromContentType(contentType);
  if (fromHeader) {
    const mime =
      fromHeader === 'pdf'
        ? 'application/pdf'
        : fromHeader === 'doc'
          ? 'application/msword'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return { mimeType: mime, extension: fromHeader };
  }

  if (suggestedName) {
    const ext = suggestedName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return { mimeType: 'application/pdf', extension: 'pdf' };
    if (ext === 'doc') return { mimeType: 'application/msword', extension: 'doc' };
    if (ext === 'docx') {
      return {
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      };
    }
  }

  return { mimeType: fromBuffer.mimeType, extension: fromBuffer.extension };
}
