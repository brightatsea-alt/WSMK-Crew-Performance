// Performance narrative + SWOT via Claude (auth required)
const { requireAuth, readJson } = require("./_auth");

const MODEL = process.env.ASSESS_MODEL || process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const SYSTEM = `You are a senior HSEQ manager / DPA at a ship management company (WSMK, Wilhelmsen Ship Management Korea) writing a concise performance appraisal of a seafarer, based on the vessels' KPI records during the periods he/she was on board.
Benchmarks: ISM Code, TMSA / RightShip best practice, Tokyo/Paris MOU & USCG PSC regimes, OCIMF and company KPI targets (PSC deficiency-free rate, zero detention, unscheduled stoppage < 24 hrs/vessel/year target, LTIF < 1.0).
Rules:
- Base every statement strictly on the data given. Compare the seafarer's vessel-period figures with the fleet averages (per vessel, current and previous year), scaling for the length of time on board.
- Attribute cautiously: the data is vessel-level, so say the seafarer "was on board when…" / "shared responsibility for…" rather than asserting personal fault, except where the rank clearly owns the area (e.g. C/E for machinery stoppages, C/O for cargo/deck & LSA/FFA findings, Master overall).
- Write in Korean (업무용 존칭 없는 보고서체), keeping technical terms (PSC, Detention, Code 17/30, LTIF, Unscheduled stoppage) in English.
- Output ONLY JSON:
{"rating":"Above fleet average"|"Around fleet average"|"Below fleet average",
 "summary":"3~5 sentences narrative: overall verdict vs fleet average and best shipping practice, key evidence (numbers), main risk area, one-line recommendation",
 "swot":{"strengths":["…"],"weaknesses":["…"],"opportunities":["…"],"threats":["…"]},
 "recommendation":"1~2 sentences: promotion/re-assignment/training recommendation"}
- Each SWOT list: 2~4 short bullet strings, each citing concrete data (vessel, date, figure). Opportunities = development/training/utilisation opportunities for the company and the seafarer; Threats = risks if the pattern continues (detention, vetting, charterer, owner KPI).`;

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });

  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "bad json" }); }
  if (!body || !body.periods) return res.status(400).json({ error: "periods 가 필요합니다." });

  const t0 = Date.now();
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1800, temperature: 0.2, system: SYSTEM,
        messages: [{ role: "user", content: "Seafarer performance data (JSON):\n" + JSON.stringify(body) + "\n\nWrite the appraisal JSON." }],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: "Claude API 연결 실패: " + e.message });
  }
  const out = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: out.error?.message || "Claude API error" });
  const text = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  let parsed;
  try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); }
  catch { return res.status(422).json({ error: "모델 응답을 JSON으로 해석할 수 없습니다.", raw: text }); }
  res.status(200).json({ ...parsed, model: MODEL, ms: Date.now() - t0 });
};
