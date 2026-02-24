/**
 * AES-256-GCM encryption/decryption using the Web Crypto API.
 *
 * Used for encrypting VPS mTLS private keys at rest in the SQLite database.
 * The output format is: base64(iv + ciphertext + tag)
 * where iv is 12 bytes, tag is 16 bytes (appended to ciphertext by AES-GCM).
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

/**
 * Import a hex-encoded 256-bit key into a CryptoKey object.
 */
async function importKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(hexKey);
  if (keyBytes.byteLength !== 32) {
    throw new Error(`Encryption key must be 32 bytes, got ${keyBytes.byteLength}`);
  }
  return crypto.subtle.importKey("raw", keyBytes as unknown as ArrayBuffer, { name: ALGORITHM, length: KEY_LENGTH }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Convert a hex string to a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt.
 * @param hexKey - 64-character hex string representing the 256-bit key.
 * @returns Base64-encoded string containing IV + ciphertext + authentication tag.
 */
export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  // Combine IV + ciphertext (which includes the auth tag in Web Crypto API)
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a ciphertext string encrypted with AES-256-GCM.
 *
 * @param ciphertext - Base64-encoded string containing IV + ciphertext + authentication tag.
 * @param hexKey - 64-character hex string representing the 256-bit key.
 * @returns The decrypted plaintext string.
 */
export async function decrypt(ciphertext: string, hexKey: string): Promise<string> {
  const key = await importKey(hexKey);
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

  if (combined.byteLength < IV_LENGTH + 1) {
    throw new Error("Ciphertext is too short to contain IV and data");
  }

  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, data);

  return new TextDecoder().decode(decrypted);
}
