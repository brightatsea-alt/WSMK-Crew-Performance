// SSMM (Ship Safety Management Manual) implementation-focus recommendation via Claude (auth required)
// Input : { seafarer, rank, summary, swot:{strengths,weaknesses,opportunities,threats}, recommendation,
//           events:{ psc:[...deficiency texts], stoppage:[...remarks], lti:[...descriptions] } }
// Output: { focus:[{section,title,clauses:[],why,actions:[]}], overall, model, ms, chapters_considered:[] }
const { requireAuth, readJson } = require("./_auth");
const SSMM = require("../data/ssmm_index.json");

const MODEL = process.env.ASSESS_MODEL || process.env.CLAUDE_MODEL || "claude-haiku-4-5";

// rank → own responsibility chapter (SSMM ch.5)
const RANK_CH = [
  [/master|capt/i, "5.1"], [/chief\s*off|c\/o|\bco\b|1st\s*off/i, "5.2"], [/2\/o|second\s*off|2nd\s*off/i, "5.3"], [/3\/o|third\s*off|3rd\s*off/i, "5.4"],
  [/chief\s*eng|c\/e|\bce\b/i, "5.6"], [/2\/e|second\s*eng|2nd\s*eng/i, "5.7"], [/3\/e|third\s*eng|3rd\s*eng/i, "5.8"],
  [/bosun|bsn/i, "5.18"], [/\bab\b|able/i, "5.19"], [/cook/i, "5.24"], [/cadet|trainee/i, "5.27"],
];
const ALWAYS = ["9.1", "9.3", "12.1"]; // undesired events, toolbox talk & RA, audits/inspections

const norm = s => String(s || "").toLowerCase();
function scoreChapters(text, rank) {
  const t = norm(text);
  const words = new Set(t.split(/[^a-z0-9가-힣/]+/).filter(w => w.length > 2));
  const scored = SSMM.chapters.map(c => {
    let s = 0;
    for (const k of c.keywords || []) { const kk = norm(k); if (!kk) continue; if (t.includes(kk)) s += kk.includes(" ") ? 3 : 1.5; }
    for (const p of c.psc_relevance || []) { for (const w of norm(p).split(/[^a-z0-9]+/)) if (w.length > 3 && words.has(w)) s += 0.7; }
    for (const w of norm(c.title).split(/[^a-z0-9]+/)) if (w.length > 3 && words.has(w)) s += 1;
    if (/^5\./.test(c.section)) s *= 0.4; // rank chapters are added explicitly below
    if (/^(2|3|3\.2|3\.3|3\.4|13|11\.[1-6])$/.test(c.section)) s *= 0.3; // admin chapters
    return { c, s };
  }).sort((a, b) => b.s - a.s);
  const pick = new Map();
  const rc = (RANK_CH.find(([re]) => re.test(rank || "")) || [])[1];
  if (rc) pick.set(rc, 1e9);
  for (const sec of ALWAYS) pick.set(sec, 1e8);
  for (const { c, s } of scored) { if (pick.size >= 11) break; if (s > 0 && !pick.has(c.section)) pick.set(c.section, s); }
  return [...pick.keys()].map(sec => SSMM.chapters.find(c => c.section === sec)).filter(Boolean);
}

const SYSTEM = `You are the DPA / Head of HSEQ of WSMK (Wilhelmsen Ship Management Korea). You have a seafarer's performance appraisal (summary, SWOT, recommendation) and the vessel KPI events recorded while he/she was on board. You also have extracts of the company's SSMM (Ship Safety Management Manual, Rev 47): chapter purpose, key requirements with clause numbers, and rank responsibilities.
Task: tell the seafarer and the crew manager WHICH SSMM requirements must be emphasised / re-implemented on the next contract, derived from the Weaknesses and Threats (and, secondarily, Opportunities) of the SWOT and the nature of the recorded events, taking the seafarer's RANK into account (cite the rank's own chapter 5.x duties where relevant).
Rules:
- Cite ONLY sections and clause numbers that appear in the SSMM extracts provided. Never invent chapters or clause numbers. Quote the clause number exactly as given (e.g. "7.1.2.6").
- 4 to 5 focus items, ordered by priority. Each item = one SSMM chapter (section + title), 1–3 specific clauses, a Korean "why" (max 2 sentences, ≤120 Korean characters) that links explicitly to a SWOT weakness/threat or a recorded event, and 2–3 concrete Korean actions (each ≤60 characters: what to do, how often, which record/checklist). Be concise — total output must stay short.
- LANGUAGE: "why", "actions" and "overall" in Korean 보고서체 (~함/~필요/~할 것). Technical terms stay English (PSC, LSA/FFA, Permit to Work, Toolbox Talk, Risk Assessment, M/E, Code 17).
- If the data shows no weakness (all figures better than fleet average), choose maintenance-of-standard items (e.g. 9.3, 8.2, 12.1) and say so.
Return ONLY this JSON, no prose:
{"focus":[{"section":"7.1.2","title":"Enclosed Spaces","clauses":["7.1.2.6","7.1.2.9"],"why":"...","actions":["...","..."]}],"overall":"<2–3 sentence Korean wrap-up on how to use these items in the next contract / appraisal>"}`;

const cut = (s, n) => (s == null ? "" : String(s).length > n ? String(s).slice(0, n) + "…" : String(s));

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
  let body; try { body = await readJson(req); } catch { return res.status(400).json({ error: "bad json" }); }
  const { seafarer, rank, summary, swot = {}, recommendation, events = {} } = body || {};
  if (!swot || !Array.isArray(swot.weaknesses)) return res.status(400).json({ error: "swot 가 필요합니다." });

  const evText = [...(events.psc || []), ...(events.stoppage || []), ...(events.lti || [])].map(x => cut(x, 300));
  const basis = [summary, ...(swot.weaknesses || []), ...(swot.threats || []), ...(swot.opportunities || []), recommendation, ...evText].join("\n");
  const chapters = scoreChapters(basis, rank);
  const extracts = chapters.map(c => ({
    section: c.section, title: c.title, purpose: cut(c.purpose, 300),
    key_requirements: (c.key_requirements || []).slice(0, 16).map(x => cut(x, 200)),
    responsibilities_by_rank: c.responsibilities_by_rank || {},
  }));
  const toc = SSMM.chapters.map(c => `${c.section} ${c.title}`).join("; ");

  const user = { seafarer, rank, appraisal: { summary: cut(summary, 1500), swot, recommendation: cut(recommendation, 600) },
    recorded_events: { psc_deficiencies: (events.psc || []).slice(0, 25).map(x => cut(x, 220)), unscheduled_stoppage: (events.stoppage || []).slice(0, 10).map(x => cut(x, 220)), lti: (events.lti || []).slice(0, 10).map(x => cut(x, 220)) },
    ssmm_extracts: extracts, ssmm_table_of_contents: toc };

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
  // parse, repairing a truncated JSON (close open strings / arrays / objects) if needed
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
  const ok = (p) => p && Array.isArray(p.focus) && p.focus.length > 0 && p.focus.every(f => f && f.section);

  let text = "", parsed = null, retried = 0;
  try {
    let a = await call();
    text = a.text;
    try { const p = parse(text); if (ok(p)) parsed = p; } catch {}
    if (!parsed || a.truncated) {
      // retry once, shorter: complete JSON is more important than length
      retried = 1;
      a = await call("\n\n주의: 직전 응답이 잘리거나 불완전한 JSON이었다. focus 항목은 4개 이내, 각 why 는 2문장 이내, actions 는 3개 이내(각 60자 이내)로 더 짧게 작성하여 반드시 완전한 JSON 하나만 출력한다.");
      try { const p = parse(a.text); if (ok(p)) { parsed = p; text = a.text; } } catch {}
    }
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  if (!parsed) return res.status(422).json({ error: "SSMM 제안 JSON을 해석할 수 없습니다.", raw: cut(text, 400) });
  // keep only sections that exist in the index; attach titles
  const known = new Map(SSMM.chapters.map(c => [c.section, c.title]));
  parsed.focus = parsed.focus.filter(f => f && known.has(String(f.section))).map(f => ({ ...f, section: String(f.section), title: f.title || known.get(String(f.section)) }));
  res.status(200).json({ ...parsed, model: MODEL, ms: Date.now() - t0, retried, chapters_considered: chapters.map(c => c.section), source: SSMM.source });
};
