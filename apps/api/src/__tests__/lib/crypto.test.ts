import { describe, it, expect } from "bun:test";
import { encrypt, decrypt } from "../../lib/crypto";

// A valid 64-character hex key (32 bytes = AES-256)
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WRONG_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("crypto", () => {
  describe("encrypt/decrypt roundtrip", () => {
    it("should encrypt and decrypt a simple string", async () => {
      const plaintext = "Hello, World!";
      const ciphertext = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(ciphertext, TEST_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt an empty string", async () => {
      const plaintext = "";
      const ciphertext = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(ciphertext, TEST_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt a PEM key", async () => {
      const pem = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIIBt2C2P0bU/VFjNfYGKZQ9qSexEI3Rl2EXZxKBwJt8PoAcGBSuBBAAi
oWQDYgAE2X5g9j8u0EcEDKqPVL9nXJIYgeCwGxJBB0zRWf/oGPK7hnVxmN3X1K7Q
-----END EC PRIVATE KEY-----`;
      const ciphertext = await encrypt(pem, TEST_KEY);
      const decrypted = await decrypt(ciphertext, TEST_KEY);
      expect(decrypted).toBe(pem);
    });

    it("should encrypt and decrypt unicode content", async () => {
      const plaintext = "Hallo Welt! \u{1F30D} \u{1F510}";
      const ciphertext = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(ciphertext, TEST_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertexts for the same plaintext (random IV)", async () => {
      const plaintext = "same input";
      const ct1 = await encrypt(plaintext, TEST_KEY);
      const ct2 = await encrypt(plaintext, TEST_KEY);
      expect(ct1).not.toBe(ct2);
    });
  });

  describe("error handling", () => {
    it("should fail to decrypt with the wrong key", async () => {
      const plaintext = "secret data";
      const ciphertext = await encrypt(plaintext, TEST_KEY);
      await expect(decrypt(ciphertext, WRONG_KEY)).rejects.toThrow();
    });

    it("should fail to decrypt tampered ciphertext", async () => {
      const plaintext = "secret data";
      const ciphertext = await encrypt(plaintext, TEST_KEY);

      // Tamper with the base64 content by changing characters in the middle
      const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
      const idx = bytes.length - 5;
      bytes[idx] = (bytes[idx] ?? 0) ^ 0xff; // flip some bits
      const tampered = btoa(String.fromCharCode(...bytes));

      await expect(decrypt(tampered, TEST_KEY)).rejects.toThrow();
    });

    it("should fail with a short ciphertext", async () => {
      const shortCiphertext = btoa("short");
      await expect(decrypt(shortCiphertext, TEST_KEY)).rejects.toThrow();
    });

    it("should fail with an invalid key length", async () => {
      await expect(encrypt("test", "0123")).rejects.toThrow();
    });
  });
});
