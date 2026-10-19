import { fromBase64Url, randomBytes, toBase64Url, toHex } from "./ids";

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return toHex(new Uint8Array(digest));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * PBKDF2-HMAC-SHA256 via Web Crypto (platform primitive, not a custom
 * implementation). Argon2id is not viable on Cloudflare Workers (10ms CPU per
 * invocation on the Free plan, no native argon2); see SECURITY.md.
 */
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64Url(parts[2] ?? "");
  const expected = parts[3] ?? "";
  if (!Number.isInteger(iterations) || iterations < 1 || salt.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return timingSafeEqual(toBase64Url(new Uint8Array(bits)), expected);
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(new Uint8Array(sig));
}

export async function encryptJson(plaintext: unknown, keyMaterial: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyMaterial as BufferSource, "AES-GCM", false, ["encrypt"]);
  const nonce = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    enc.encode(JSON.stringify(plaintext)),
  );
  return `v1$${toBase64Url(nonce)}$${toBase64Url(new Uint8Array(ct))}`;
}

export async function decryptJson<T>(payload: string, keyMaterial: Uint8Array): Promise<T> {
  const parts = payload.split("$");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported ciphertext format");
  const key = await crypto.subtle.importKey("raw", keyMaterial as BufferSource, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(parts[1] ?? "") as BufferSource },
    key,
    fromBase64Url(parts[2] ?? "") as BufferSource,
  );
  return JSON.parse(dec.decode(pt)) as T;
}

export function deriveEncryptionKey(hexKey: Uint8Array): Uint8Array {
  // Key material is already 32 bytes of hex-decoded entropy; use as-is.
  return hexKey;
}
