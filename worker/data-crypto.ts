const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_DERIVATION_SALT = encoder.encode("ruta-verde-secure-storage-v2");

export type EncryptedEnvelope = {
  v: 2;
  iv: string;
  data: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function masterKeyBytes(keyBase64: string) {
  const bytes = base64ToBytes(keyBase64);
  if (bytes.byteLength !== 32) {
    throw new Error("ROUTE_DATA_KEY debe contener exactamente 32 bytes codificados en Base64.");
  }
  return bytes;
}

async function derivePurposeKey(keyBase64: string, purpose: string) {
  const master = await crypto.subtle.importKey(
    "raw",
    masterKeyBytes(keyBase64),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: KEY_DERIVATION_SALT,
      info: encoder.encode(purpose),
    },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function authenticatedData(purpose: string, recordId: string) {
  return encoder.encode(`ruta-verde|${purpose}|${recordId}|v2`);
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<EncryptedEnvelope>;
  return envelope.v === 2 && typeof envelope.iv === "string" && typeof envelope.data === "string";
}

export async function encryptJson(value: unknown, keyBase64: string, purpose: string, recordId: string) {
  const key = await derivePurposeKey(keyBase64, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: authenticatedData(purpose, recordId),
      tagLength: 128,
    },
    key,
    plaintext,
  );
  return {
    v: 2,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  } satisfies EncryptedEnvelope;
}

export async function decryptJson<T>(envelope: EncryptedEnvelope, keyBase64: string, purpose: string, recordId: string) {
  const key = await derivePurposeKey(keyBase64, purpose);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.iv),
      additionalData: authenticatedData(purpose, recordId),
      tagLength: 128,
    },
    key,
    base64ToBytes(envelope.data),
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
}
