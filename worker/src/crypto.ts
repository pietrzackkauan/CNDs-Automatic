import crypto from "crypto";

const SECRET = process.env.ENCRYPTION_KEY || "cnd_secret_key_antigravity_2026_aes256_protect";
const KEY = crypto.createHash("sha256").update(SECRET).digest();

export function decryptText(ciphertext: string): string {
  if (!ciphertext) return "";
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(":");
    if (!ivHex || !tagHex || !dataHex) return "";

    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(dataHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err: any) {
    console.error("Erro ao descriptografar credencial:", err.message);
    return "";
  }
}

export function encryptText(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${enc}`;
}
