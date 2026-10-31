// Utilitário de criptografia AES-256-GCM para proteger credenciais no navegador antes de salvar no Supabase

const SECRET = import.meta.env.VITE_ENCRYPTION_KEY || "cnd_secret_key_antigravity_2026_aes256_protect";

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(SECRET));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    encoded
  );

  // No Web Crypto, os últimos 16 bytes do ciphertext são a tag de autenticação
  const cipherBytes = new Uint8Array(ciphertext);
  const dataBytes = cipherBytes.slice(0, cipherBytes.length - 16);
  const tagBytes = cipherBytes.slice(cipherBytes.length - 16);

  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");

  return `${toHex(iv)}:${toHex(tagBytes)}:${toHex(dataBytes)}`;
}
