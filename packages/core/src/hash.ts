import { createHash } from 'node:crypto';

export const sha = (data: string | Uint8Array, len = 16): string => createHash('sha256').update(data).digest('hex').slice(0, len);
