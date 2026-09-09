// Screenshot -> sea-service records via Claude vision (auth required)
const { requireAuth, readJson } = require("./_auth");
const data = require("../data/index.json");

// Haiku 4.5 is the fastest vision-capable model; override with CLAUDE_MODEL if needed
// (e.g. claude-sonnet-5 for harder / low-quality screenshots).
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const SYSTEM = `You read screenshots of a seafarer's sea-service record (승선 이력 / crew career table) from a ship-management crewing system.
Extract every row that describes a period on board a vessel.
Return ONLY a JSON object of this shape, no prose:
{"seafarer": "<name if visible, else null>", "entries":[{"vessel":"<vessel name as written>","rank":"<rank if visible, else null>","sign_on":"YYYY-MM-DD","sign_off":"YYYY-MM-DD or null if still on board / blank"}]}
Rules:
- Dates may appear as DD/MM/YYYY, YYYY.MM.DD, DD-MMM-YY, etc. Convert to ISO YYYY-MM-DD. If the day is missing, use 01. If a year is 2 digits, assume 20xx.
- If a row shows only one date or the sign-off is blank / "present" / "~", set sign_off to null.
- Keep vessel names exactly as written (do not translate). Ignore leading "M/V", "MV".
- Ignore rows that are not vessel service (training, leave, office).
- Sort by sign_on ascending.
Known fleet vessel names (use to correct OCR mistakes when the match is obvious): ${data.vessels.join(", ")}`;

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });

  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "bad json" }); }
  const { image, media_type } = body || {};
  if (!image) return res.status(400).json({ error: "image (base64) 가 필요합니다." });

  const payload = {
    model: MODEL,
    max_tokens: 2000,
    temperature: 0,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: media_type || "image/png", data: image } },
        { type: "text", text: "Extract the sea-service entries from this screenshot as JSON." },
      ],
    }],
  };

  const t0 = Date.now();
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return res.status(502).json({ error: "Claude API 연결 실패: " + e.message });
  }
  const out = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: out.error?.message || "Claude API error", detail: out });

  const text = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  let parsed = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return res.status(422).json({ error: "모델 응답을 JSON으로 해석할 수 없습니다.", raw: text });
  }
  const entries = (parsed.entries || []).filter(e => e && e.vessel && e.sign_on).map(e => ({
    vessel: String(e.vessel).trim(),
    rank: e.rank || null,
    sign_on: e.sign_on,
    sign_off: e.sign_off || null,
  }));
  res.status(200).json({
    seafarer: parsed.seafarer || null,
    entries,
    model: MODEL,
    ms: Date.now() - t0,
    usage: out.usage,
  });
};
