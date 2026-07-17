import { readFile, writeFile, chmod } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import process from "node:process";

const [, , inputPath, outputPath = "worker/vault/sector-map.ts"] = process.argv;
const keyBase64 = process.env.ROUTE_DATA_KEY;
const aadText = "ruta-verde-route-data-v1";

if (!inputPath || !keyBase64) {
  console.error("Uso: ROUTE_DATA_KEY=<base64> npm run security:encrypt-route -- private/route.json [salida]");
  process.exit(1);
}

const keyBytes = Buffer.from(keyBase64, "base64");
if (keyBytes.byteLength !== 32) {
  console.error("ROUTE_DATA_KEY debe contener exactamente 32 bytes codificados en Base64.");
  process.exit(1);
}

const plaintextText = await readFile(inputPath, "utf8");
const parsed = JSON.parse(plaintextText);
if (parsed?.version !== 1 || !Array.isArray(parsed?.stops) || parsed.stops.length === 0) {
  console.error("El archivo privado debe contener { version: 1, stops: [...] }.");
  process.exit(1);
}

const key = await webcrypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const encrypted = await webcrypto.subtle.encrypt(
  {
    name: "AES-GCM",
    iv,
    additionalData: new TextEncoder().encode(aadText),
    tagLength: 128,
  },
  key,
  new TextEncoder().encode(JSON.stringify(parsed)),
);

const ivBase64 = Buffer.from(iv).toString("base64");
const ciphertextBase64 = Buffer.from(encrypted).toString("base64");
const moduleSource = `const PRIVATE_ROUTE_AAD = ${JSON.stringify(aadText)};
const PRIVATE_ROUTE_IV_B64 = ${JSON.stringify(ivBase64)};
const PRIVATE_ROUTE_CIPHERTEXT_B64 = ${JSON.stringify(ciphertextBase64)};

function base64Bytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function decryptPrivateRoute(keyBase64: string) {
  const rawKey = base64Bytes(keyBase64);
  if (rawKey.byteLength !== 32) {
    throw new Error("ROUTE_DATA_KEY debe ser una clave AES-256 de 32 bytes codificada en Base64.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64Bytes(PRIVATE_ROUTE_IV_B64),
      additionalData: new TextEncoder().encode(PRIVATE_ROUTE_AAD),
      tagLength: 128,
    },
    key,
    base64Bytes(PRIVATE_ROUTE_CIPHERTEXT_B64),
  );

  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as { version?: unknown; stops?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.stops)) {
    throw new Error("El bloque cifrado del recorrido no tiene un formato válido.");
  }
  return parsed.stops;
}
`;

await writeFile(outputPath, moduleSource, { encoding: "utf8", mode: 0o600 });
await chmod(outputPath, 0o600).catch(() => {});
console.log(`Bóveda actualizada de forma segura: ${outputPath}`);
