// Shared auth helpers for Vercel serverless functions (Node runtime)
const crypto = require("crypto");

const PASSWORD = process.env.APP_PASSWORD || "wsmk2026!";
const SECRET = process.env.SESSION_SECRET || "wsmk-crew-perf-" + PASSWORD;
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function getToken(req) {
  const h = req.headers["authorization"] || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const cookie = req.headers["cookie"] || "";
  const m = cookie.match(/(?:^|;\s*)wsmk_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function requireAuth(req, res) {
  const payload = verify(getToken(req));
  if (!payload) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

function issueToken() {
  return sign({ exp: Date.now() + TTL_MS, iat: Date.now() });
}

function checkPassword(pw) {
  if (typeof pw !== "string") return false;
  const a = Buffer.from(pw), b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

module.exports = { requireAuth, issueToken, checkPassword, readJson, TTL_MS };
