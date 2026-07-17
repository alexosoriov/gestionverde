const DB_NAME = "ruta-verde-offline";
const DB_VERSION = 2;
const DEVICE_KEY_ID = "journey-device-aes-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type DataStore = "journeys" | "outbox";
type StoreName = DataStore | "keys";

type SecureEnvelope = {
  v: 1;
  iv: string;
  data: string;
};

let deviceKeyPromise: Promise<CryptoKey> | null = null;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("journeys")) database.createObjectStore("journeys");
      if (!database.objectStoreNames.contains("outbox")) database.createObjectStore("outbox");
      if (!database.objectStoreNames.contains("keys")) database.createObjectStore("keys");
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isSecureEnvelope(value: unknown): value is SecureEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<SecureEnvelope>;
  return envelope.v === 1 && typeof envelope.iv === "string" && typeof envelope.data === "string";
}

async function readRaw<T>(storeName: StoreName, key: string) {
  const database = await openDatabase();
  return new Promise<T | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer el almacenamiento"));
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    transaction.oncomplete = () => database.close();
  });
}

async function writeRaw<T>(storeName: StoreName, key: string, value: T) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo guardar en el teléfono"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}

async function deviceKey() {
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      const existing = await readRaw<CryptoKey>("keys", DEVICE_KEY_ID);
      if (existing) return existing;
      const generated = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await writeRaw("keys", DEVICE_KEY_ID, generated);
      return generated;
    })();
  }
  return deviceKeyPromise;
}

function additionalData(context: string) {
  return encoder.encode(`ruta-verde-local|${context}|v1`);
}

export async function sealLocalValue(value: unknown, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(context),
      tagLength: 128,
    },
    await deviceKey(),
    encoder.encode(JSON.stringify(value)),
  );
  return {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  } satisfies SecureEnvelope;
}

export async function openLocalValue<T>(value: unknown, context: string) {
  if (!isSecureEnvelope(value)) return value as T;
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(value.iv),
      additionalData: additionalData(context),
      tagLength: 128,
    },
    await deviceKey(),
    base64ToBytes(value.data),
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
}

export async function readSecureStored<T>(storeName: DataStore, key: string) {
  const stored = await readRaw<unknown>(storeName, key);
  if (stored === null) return null;
  const value = await openLocalValue<T>(stored, `${storeName}:${key}`);
  if (!isSecureEnvelope(stored)) await writeSecureStored(storeName, key, value);
  return value;
}

export async function writeSecureStored<T>(storeName: DataStore, key: string, value: T) {
  const encrypted = await sealLocalValue(value, `${storeName}:${key}`);
  await writeRaw(storeName, key, encrypted);
}

export async function deleteStored(storeName: DataStore, key: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo limpiar el almacenamiento"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}
