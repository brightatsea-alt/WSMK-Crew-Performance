// Performance narrative + SWOT via Claude (auth required)
const { requireAuth, readJson } = require("./_auth");

const MODEL = process.env.ASSESS_MODEL || process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const SYSTEM = `You are a senior HSEQ manager / DPA at a ship management company (WSMK, Wilhelmsen Ship Management Korea) writing a concise performance appraisal of a seafarer, based on the vessels' KPI records during the periods he/she was on board.
Benchmarks: ISM Code, TMSA / RightShip best practice, Tokyo/Paris MOU & USCG PSC regimes, OCIMF and company KPI targets (PSC deficiency-free rate, zero detention, unscheduled stoppage < 24 hrs/vessel/year target, LTIF < 1.0).
Rules:
- Base every statement strictly on the data given. Compare the seafarer's vessel-period figures with the fleet averages (per vessel, current and previous year), scaling for the length of time on board.
- Attribute cautiously: the data is vessel-level, so say the seafarer "was on board when…" / "shared responsibility for…" rather than asserting personal fault, except where the rank clearly owns the area (e.g. C/E for machinery stoppages, C/O for cargo/deck & LSA/FFA findings, Master overall).
- LANGUAGE: every sentence of summary, swot bullets and recommendation MUST be written in Korean (보고서체, 예: "~함", "~됨", "~필요"). Only technical terms stay in English (PSC, Detention, Code 17/30, LTIF, Unscheduled stoppage, M/E, LSA/FFA). Never write English sentences.
- Evaluate by RANK and by the NATURE of each event: read every PSC deficiency text, stoppage remark and LTI description, decide which department/rank owns it, and weigh only the events within the seafarer's responsibility heavily; events outside it are context only. Mention the nature (e.g. LSA/FFA, fire safety, ISM/SMS, machinery, cargo gear, navigation, hull/structure) explicitly.
- Rank responsibility: Unscheduled stoppage / machinery failures (M/E, G/E, boiler, propulsion) belong to the engine department (C/E, 2/E) — do NOT attribute them to Master, C/O or deck officers; for deck officers mention them only as "승선 중 발생한 선박 실적" context. Deck officers (C/O, 2/O, 3/O) own navigation, cargo, LSA/FFA, deck maintenance findings; Master owns SMS implementation and overall PSC outcome.
- Output ONLY JSON:
{"rating":"Above fleet average"|"Around fleet average"|"Below fleet average",
 "summary":"3~5 sentences narrative: overall verdict vs fleet average and best shipping practice, key evidence (numbers), main risk area, one-line recommendation",
 "swot":{"strengths":["…"],"weaknesses":["…"],"opportunities":["…"],"threats":["…"]},
 "recommendation":"1~2 sentences: promotion/re-assignment/training recommendation"}
- Each SWOT list: 2~3 short bullet strings (max 110 Korean characters each). Keep the whole JSON under 1,500 Korean characters. No markdown, no code fences, no text before or after the JSON, each citing concrete data (vessel, date, figure). Opportunities = development/training/utilisation opportunities for the company and the seafarer; Threats = risks if the pattern continues (detention, vetting, charterer, owner KPI).`;

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });

  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "bad json" }); }
  if (!body || !body.periods) return res.status(400).json({ error: "periods 가 필요합니다." });

  // Trim the payload so long careers (20+ inspections) stay well inside the context/output budget
  const cut = (v, n) => (v == null ? v : String(v).slice(0, n));
  const slim = {
    ...body,
    periods: (body.periods || []).map(p => ({
      ...p,
      psc: (p.psc || []).map(x => ({ ...x, items: (x.items || []).slice(0, 6).map(t => cut(t, 90)) })),
      unscheduled_stoppage: (p.unscheduled_stoppage || []).map(u => ({ ...u, remark: cut(u.remark, 90) })),
      lti: (p.lti || []).map(l => ({ ...l, desc: cut(l.desc, 90) })),
    })),
  };

  const t0 = Date.now();
  const call = async (extra) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 3000, temperature: 0.2, system: SYSTEM,
        messages: [
          { role: "user", content: "Seafarer performance data (JSON):\n" + JSON.stringify(slim) + "\n\n위 데이터로 appraisal JSON을 작성. 모든 문장은 반드시 한국어(보고서체)로 작성하고, 영어 문장은 쓰지 않는다. 직급(rank)과 각 사건의 성격(nature)을 기준으로 책임 영역을 구분하여 평가한다." + (extra || "") },
          { role: "assistant", content: "{" },
        ],
      }),
    });
    const out = await r.json();
    if (!r.ok) throw Object.assign(new Error(out.error?.message || "Claude API error"), { status: r.status });
    return "{" + (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  };
  const parse = (text) => {
    const start = text.indexOf("{"); if (start < 0) throw new Error("no json");
    let t = text.slice(start).replace(/```[a-z]*\n?|```/g, "").trim();
    const end = t.lastIndexOf("}"); if (end > 0) t = t.slice(0, end + 1);
    try { return JSON.parse(t); } catch {}
    // repair a truncated JSON: close open strings/arrays/objects
    let s2 = t, inStr = false, esc = false, stack = [];
    for (const ch of s2) {
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === "{" || ch === "[") stack.push(ch); else if (ch === "}" || ch === "]") stack.pop();
    }
    if (inStr) s2 += '"';
    s2 = s2.replace(/,\s*$/, "");
    while (stack.length) { const o = stack.pop(); s2 += o === "{" ? "}" : "]"; }
    return JSON.parse(s2);
  };

  let text = "", parsed = null, attempt = 0;
  try {
    text = await call();
    try { parsed = parse(text); }
    catch {
      attempt = 1;
      text = await call("\n\n주의: 직전 응답이 유효한 JSON이 아니었다. 문장을 더 짧게 하여 반드시 완전한 JSON 하나만 출력한다.");
      parsed = parse(text);
    }
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    return res.status(422).json({ error: "모델 응답을 JSON으로 해석할 수 없습니다. 다시 생성을 눌러 주세요.", raw: cut(text, 500) });
  }
  res.status(200).json({ ...parsed, model: MODEL, ms: Date.now() - t0, retried: attempt });
};
