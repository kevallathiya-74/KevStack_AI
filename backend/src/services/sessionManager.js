const crypto = require("crypto");
const { loadEnv } = require("../config/env");

const env = loadEnv();
let cachedKey = null;

function getEncryptionKey() {
  if (cachedKey) {
    return cachedKey;
  }

  const secret = String(env.linkedInSessionSecret || "").trim();
  if (!secret) {
    throw new Error("LINKEDIN_SESSION_SECRET is required to encrypt LinkedIn sessions.");
  }

  cachedKey = crypto.scryptSync(secret, "kevstack-linkedin-session", 32);
  return cachedKey;
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptJson(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  const iv = Buffer.from(String(parsed.iv || ""), "base64");
  const tag = Buffer.from(String(parsed.tag || ""), "base64");
  const data = Buffer.from(String(parsed.data || ""), "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted);
}

module.exports = {
  decryptJson,
  encryptJson,
};
