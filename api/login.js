const { issueToken, checkPassword, readJson, TTL_MS } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "bad json" }); }
  if (!checkPassword(body.password)) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }
  const token = issueToken();
  res.setHeader("Set-Cookie", `wsmk_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${TTL_MS / 1000}`);
  res.status(200).json({ ok: true, token });
};
