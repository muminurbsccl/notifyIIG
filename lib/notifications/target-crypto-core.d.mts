export function parseEncryptionKey(value: string): Buffer;
export function encryptTargetCore(plaintext: string, encryptionKey: string): string;
export function decryptTargetCore(payload: string, encryptionKey: string): string;
export function maskTargetCore(channel: string, target: string): string;
