// Engineer-only supplement: which PMS jobs / machinery need supplementary inspection, per best shipping practice (auth required)
// Input : { seafarer, rank, vessels:[names], summary, swot, recommendation, events:{psc,stoppage,lti}, ssmm_focus:[{section,title,clauses}] }
// Output: { items:[{system,equipment,check,pms,basis,link,priority}], overall, model, ms, retried }
const { requireAuth, readJson } = require("./_auth");
const SSMM = require("../data/ssmm_index.json");

const MODEL = process.env.ASSESS_MODEL || process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const ENG_RE = /(chief\s*eng|c\/e|\bce\b|\d\s*\/\s*e\b|(first|second|third|fourth|1st|2nd|3rd|4th)\s*eng|\beng(ineer)?\b|eto|electr|oiler|wiper|motorman|fitter|pumpman|gas\s*eng)/i;
const ENG_SECTIONS = ["10.1", "7.1.8", "7.16", "7.19", "7.1.1", "7.18", "10.4", "8.2"]; // maintenance, critical equipment, UMS, bunkering, LOTO, pollution, fire, drills
const RANK_CH = [[/chief\s*eng|c\/e|\bce\b/i, "5.6"], [/2\s*\/\s*e|second\s*eng|2nd\s*eng/i, "5.7"], [/3\s*\/\s*e|third\s*eng|3rd\s*eng/i, "5.8"]];

const cut = (s, n) => (s == null ? "" : String(s).length > n ? String(s).slice(0, n) + "…" : String(s));
const vType = v => /^(HLS|GAS|HYUNDAI)/i.test(v) ? "LNG carrier (inferred)" : /^(HL |BERGE|CAPE|SALDANHA)/i.test(v) ? "Bulk carrier (inferred)" : /^(MORNING|ASIAN|LIBERTY|GLOVIS|ARCTIC)/i.test(v) ? "PCTC (inferred)" : "unknown";

const SYSTEM = `You are the Technical / HSEQ superintendent of WSMK (Wilhelmsen Ship Management Korea) preparing an engineer's next-contract briefing. You have the engineer's performance appraisal (summary, SWOT, recommendation), the KPI events recorded while on board (PSC deficiencies, unscheduled machinery stoppages / operational delays, LTIs), the SSMM focus items already selected, and extracts of the company SSMM chapters on maintenance, critical equipment, UMS, bunkering, LOTO, pollution prevention and fire safety.
Task: based on BEST SHIPPING PRACTICE — OCIMF TMSA 3 (Element 4 Reliability & Maintenance, Element 5 Navigation excluded), RightShip RISQ / Ship Inspection questionnaire machinery items, SIRE 2.0 engine-room chapters, classification society PMS / CMS survey scope, SOLAS II-1 & II-2, MARPOL Annex I (OWS, bilge, ODME, sludge) and Annex VI (fuel, EGCS, NOx), IMO MSC.1/Circ. on critical equipment, and maker recommendations — identify WHICH PMS JOBS and WHICH MACHINERY / EQUIPMENT this engineer should give SUPPLEMENTARY INSPECTION or intensified follow-up on the next contract, taking the rank's duty scope into account (C/E = department & compliance, 2/E = M/E, PMS execution, watch/UMS; 3/E = auxiliaries, boiler, purifiers, generators, fuel treatment; 4/E / ETO = electrical, automation, alarms).
Rules:
- PRIORITY OF EVIDENCE: build the items FIRST and MAINLY from the RECORDED EVENTS while this engineer was on board — (1) Unplanned Unavailability / unscheduled stoppages (machinery breakdowns, operational delays: the machinery that failed and the root-cause family), (2) accidents / LTIs (the equipment or job involved), (3) PSC deficiencies related to machinery, engine room, MARPOL, fire safety, electrical, steering, LSA/FFA in the engine department. Every such event MUST be covered by at least one item that names the event (date, vessel, hours / deficiency text) in "link". Only after the events are covered, add SWOT-based or vessel-type standard items to reach the item count. If no event is recorded, say so in "overall" and propose standard-maintenance items typical for the vessel type.
- For each stoppage / breakdown, propose the PMS job that would have detected it earlier (condition monitoring, overhaul interval, spare parts, alarm test) and the supplementary inspection to prevent recurrence.
- 5 to 6 items ordered by priority, each field concise (check / pms / link ≤ 2 sentences and ≤120 Korean characters, basis ≤ 60 characters). Total output must stay short. For each: system (e.g. "M/E", "Aux. engine / generator", "Boiler & steam", "Fuel oil treatment", "OWS / bilge / MARPOL", "Fire & safety equipment", "Steering gear", "Electrical & automation", "Cargo / ramp hydraulics (PCTC)", "Cargo handling & GCU (LNG)"), the specific equipment, what to check (concrete, measurable), how to reflect it in PMS (job name / interval / record), the best-practice basis (name the standard/element/questionnaire item), the link to SWOT/event, and priority 상/중/하.
- Do not invent vessel-specific makers or part numbers; keep to generic but concrete engineering checks. Where you refer to SSMM, use only the section/clause numbers in the extracts provided.
- LANGUAGE: check / pms / basis / link / overall / recommendation in Korean 보고서체 (~함/~할 것/~필요). Technical terms and standard names stay English (TMSA, RISQ, SIRE, OWS, ODME, PMS, M/E, A/E, LOTO, UMS).
- ENGINEER RECOMMENDATION (separate from the items): a guidance block addressed to this engineer for the next contract, derived from the Unplanned Unavailability records and the engine-related PSC deficiencies: "headline" (1 sentence, the single most important message), "guidance" = 3–5 topics, each {"topic": short title (e.g. "M/E 신뢰성 / Unplanned Unavailability 예방", "PSC 기관실 대비", "MARPOL 기록·OWS", "기관부 안전관리·LOTO"), "guide": 2–3 sentences of practical guidance (what to do before joining, in the first 2 weeks on board, and routinely), "ref": the event or PSC deficiency it answers}. If there is no UA or engine-related PSC record, say so and give standard best-practice guidance for the rank and vessel type.
Return ONLY this JSON, no prose:
{"recommendation":{"headline":"...","guidance":[{"topic":"...","guide":"...","ref":"..."}]},"items":[{"system":"M/E","equipment":"...","check":"...","pms":"...","basis":"TMSA 3 El.4 KPI 4.2 / RISQ 8.x","link":"...","priority":"상"}],"overall":"<2–3 sentence Korean wrap-up on how to prioritise these checks and record them (PMS, handover note, SMR)>"}`;

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
  let body; try { body = await readJson(req); } catch { return res.status(400).json({ error: "bad json" }); }
  const { seafarer, rank, vessels = [], summary, swot = {}, recommendation, events = {}, ssmm_focus = [] } = body || {};
  if (!ENG_RE.test(rank || "")) return res.status(400).json({ error: "기관부 직급이 아닙니다.", engineer: false });

  const secs = [...new Set([(RANK_CH.find(([re]) => re.test(rank || "")) || [])[1], ...ENG_SECTIONS].filter(Boolean))];
  const extracts = secs.map(s => SSMM.chapters.find(c => c.section === s)).filter(Boolean).map(c => ({
    section: c.section, title: c.title, purpose: cut(c.purpose, 250), key_requirements: (c.key_requirements || []).slice(0, 14).map(x => cut(x, 180)) }));

  const user = { seafarer, rank, vessels: (vessels || []).slice(0, 12).map(v => ({ name: v, type: vType(v) })),
    appraisal: { summary: cut(summary, 1500), swot, recommendation: cut(recommendation, 600) },
    recorded_events: { psc_deficiencies: (events.psc || []).slice(0, 25).map(x => cut(x, 220)), unscheduled_stoppage: (events.stoppage || []).slice(0, 20).map(x => cut(x, 400)), lti: (events.lti || []).slice(0, 10).map(x => cut(x, 220)) },
    ssmm_focus_already_selected: (ssmm_focus || []).slice(0, 8).map(f => ({ section: f.section, title: f.title, clauses: f.clauses })),
    ssmm_machinery_extracts: extracts };

  const t0 = Date.now();
  const call = async (extra) => {
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM,
          messages: [{ role: "user", content: [{ type: "text", text: "Data:\n" + JSON.stringify(user) + "\n\nReturn the JSON now." + (extra || "") }] }] }),
      });
    } catch (e) { throw Object.assign(new Error("Claude API 연결 실패: " + e.message), { status: 502 }); }
    const out = await r.json();
    if (!r.ok) throw Object.assign(new Error(out.error?.message || "Claude API error"), { status: r.status });
    return { text: (out.content || []).filter(c => c.type === "text").map(c => c.text).join(""), truncated: out.stop_reason === "max_tokens" };
  };
  const parse = (text) => {
    const start = text.indexOf("{"); if (start < 0) throw new Error("no json");
    let t = text.slice(start).replace(/```[a-z]*\n?|```/g, "").trim();
    const end = t.lastIndexOf("}"); if (end > 0) t = t.slice(0, end + 1);
    try { return JSON.parse(t); } catch {}
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
  const ok = p => p && Array.isArray(p.items) && p.items.length > 0 && p.items.every(i => i && (i.equipment || i.system));

  let text = "", parsed = null, retried = 0;
  try {
    let a = await call(); text = a.text;
    try { const p = parse(text); if (ok(p)) parsed = p; } catch {}
    if (!parsed || a.truncated) {
      retried = 1;
      a = await call("\n\n주의: 직전 응답이 잘리거나 불완전한 JSON이었다. items 5개 이내·guidance 3개 이내, 각 필드 2문장(80자) 이내로 더 짧게 작성하여 반드시 완전한 JSON 하나만 출력한다.");
      try { const p = parse(a.text); if (ok(p)) { parsed = p; text = a.text; } } catch {}
    }
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  if (!parsed) return res.status(422).json({ error: "PMS 보완점검 JSON을 해석할 수 없습니다.", raw: cut(text, 400) });
  const rec = parsed.recommendation && typeof parsed.recommendation === "object" ? parsed.recommendation : {};
  parsed.recommendation = { headline: String(rec.headline || ""), guidance: Array.isArray(rec.guidance) ? rec.guidance.filter(x => x && (x.guide || x.topic)).slice(0, 6).map(x => ({ topic: String(x.topic || ""), guide: String(x.guide || ""), ref: String(x.ref || "") })) : [] };
  parsed.items = parsed.items.map(i => ({ system: String(i.system || ""), equipment: String(i.equipment || ""), check: String(i.check || ""), pms: String(i.pms || ""), basis: String(i.basis || ""), link: String(i.link || ""), priority: /상|high/i.test(i.priority) ? "상" : /하|low/i.test(i.priority) ? "하" : "중" }));
  res.status(200).json({ ...parsed, model: MODEL, ms: Date.now() - t0, retried, engineer: true, ssmm_sections: secs });
};
