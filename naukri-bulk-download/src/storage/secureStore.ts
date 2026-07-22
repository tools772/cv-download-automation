import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

interface EncryptedEnvelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export async function writeEncryptedJson<T>(
  filePath: string,
  payload: T,
  encryptionKey?: string,
): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  const raw = JSON.stringify(payload, null, 2);

  if (!encryptionKey) {
    await fs.writeFile(filePath, raw, 'utf8');
    return;
  }

  const key = deriveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(raw, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };

  await fs.writeJson(filePath, envelope, { spaces: 2 });
}

export async function readEncryptedJson<T>(
  filePath: string,
  encryptionKey?: string,
): Promise<T | null> {
  if (!(await fs.pathExists(filePath))) return null;
  const parsed = await fs.readJson(filePath);

  if (!encryptionKey) {
    return parsed as T;
  }

  const envelope = parsed as EncryptedEnvelope;
  if (!envelope?.iv || !envelope?.tag || !envelope?.data) {
    return parsed as T;
  }

  const key = deriveKey(encryptionKey);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}
