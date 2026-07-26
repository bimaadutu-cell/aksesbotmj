import crypto from "crypto";

const SECRET = process.env.TOKEN_SECRET || "aksesbotmu::bimz-official::default-secret";
const KEY = crypto.createHash("sha256").update(SECRET).digest();

/** AES-256-GCM encrypt — bot tokens are never stored in plain text */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

/** 123456:ABC-DEF...xyz  ->  1234••••••:••••••••••xyz */
export function maskToken(token: string): string {
  const [id, rest] = token.split(":");
  if (!rest) return "••••••••••••";
  return `${id.slice(0, 4)}••••••:••••••••••••${rest.slice(-4)}`;
}

export function signSession(userId: string): string {
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  const body = Buffer.from(JSON.stringify({ u: userId, e: exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expect = crypto.createHmac("sha256", KEY).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof data.e === "number" && data.e > Date.now();
  } catch {
    return false;
  }
}

/** simple per-ip token bucket rate limiter */
const buckets = new Map<string, { n: number; t: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.t > windowMs) {
    buckets.set(key, { n: 1, t: now });
    return true;
  }
  if (b.n >= max) return false;
  b.n++;
  return true;
}
