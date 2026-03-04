import { useState, useRef, useEffect, useCallback } from "react";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const DEFAULT_COUNCIL = [
  { id: 0, name: "The Contrarian",   emoji: "⚔️",  color: "#FF4444", bg: "#1a0000", trait: "You bet against the crowd. If everyone thinks yes, you think no. Actively find why consensus is wrong.", shortTrait: "Against consensus" },
  { id: 1, name: "The Statistician", emoji: "📊",  color: "#4488FF", bg: "#00091a", trait: "Pure data, base rates, historical probabilities. Strip away all narrative and emotion. Numbers only.", shortTrait: "Data & base rates" },
  { id: 2, name: "The Gut",          emoji: "🔥",  color: "#FF8C42", bg: "#120800", trait: "Pure instinct and intuition. No charts, no data, no history. Feel the answer and trust it completely.", shortTrait: "Pure instinct" },
  { id: 3, name: "The Devil",        emoji: "😈",  color: "#CC44FF", bg: "#0d0019", trait: "Hunt black swans, tail risks, overlooked chaos. What is everyone ignoring? What could go catastrophically wrong?", shortTrait: "Black swan hunter" },
  { id: 4, name: "The Pragmatist",   emoji: "💼",  color: "#00C896", bg: "#000f0a", trait: "Follow incentives and money. Who benefits from each outcome? Reason backwards from cui bono.", shortTrait: "Follows incentives" },
];

const HORIZONS = [
  { key: "ultrashort", label: "ULTRA-SHORT", icon: "⚡", color: "#FF4444", desc: "Closes within 48 hours", badge: "< 48 HRS", closes: "within 48 hours" },
  { key: "short",      label: "SHORT-TERM",  icon: "🔥", color: "#FF8C42", desc: "Closes within 2 weeks",  badge: "< 2 WKS",  closes: "within 2 weeks" },
  { key: "medium",     label: "MEDIUM-TERM", icon: "📅", color: "#D4AF37", desc: "Closes in 1–3 months",   badge: "1–3 MO",   closes: "in 1 to 3 months" },
  { key: "long",       label: "LONG-TERM",   icon: "🔭", color: "#4488FF", desc: "Closes in 3+ months",    badge: "3+ MO",    closes: "in more than 3 months" },
];

const RISK_CONFIGS = {
  low:      { label: "Low Risk",   color: "#00C896", desc: "Safe bets — 65–90% YES.",       instruction: "Find markets where YES probability is between 65% and 90%." },
  balanced: { label: "Balanced",   color: "#D4AF37", desc: "Genuine uncertainty — 35–65%.", instruction: "Find markets with genuine uncertainty, odds close to 50/50." },
  high:     { label: "High Risk",  color: "#FF8C42", desc: "Underdog bets — 15–40% YES.",   instruction: "Find markets where YES probability is between 15% and 40%." },
  degen:    { label: "Degen 🎰",   color: "#FF4444", desc: "Long shots — under 20% YES.",   instruction: "Find markets with YES probability under 20% — extreme long shots only." },
};

const ALL_CATEGORIES = ["Crypto","Politics","Finance","Sports","Pop Culture","Tech","Weather","Science","Entertainment","Other"];
const CAT_COLORS     = { Crypto:"#FF8C42",Politics:"#CC44FF",Finance:"#4488FF",Sports:"#00C896","Pop Culture":"#FF69E2",Tech:"#D4AF37",Weather:"#88aaff",Science:"#00C896",Entertainment:"#FF69E2",Other:"#888" };
const ADVISOR_COLORS = ["#FF4444","#4488FF","#D4AF37","#FF8C42","#CC44FF","#00C896","#FF69E2","#e0e0e0","#aaa","#ff6b6b","#48dbfb","#ff9f43"];
const ADVISOR_EMOJIS = ["🧠","🦁","🐍","🎯","⚡","🌊","🔮","🃏","🦊","🐉","🌙","☄️","🎲","🧬","🏺","🗡️","🦅","🌀","🔱","💎"];

const PHASES    = { IDLE:"idle", SEARCHING:"searching", PREDICTING:"predicting", ARGUING:"arguing", VOTING:"voting", RESULT:"result" };
const MAIN_TABS = { SCOUT:"scout", COUNCIL:"council", HISTORY:"history", ROSTER:"roster", LEADERBOARD:"leaderboard", ARBITRAGE:"arbitrage" };

// ── LOCAL STORAGE HELPERS ─────────────────────────────────────────────────────
// Replaces window.storage (Claude artifact API) with standard localStorage
// so the app works outside the Claude.ai sandbox.

const LS = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  // Shared leaderboard: stored under a "shared:" prefix in localStorage.
  // In production replace these two methods with real API calls (Supabase, etc.)
  getShared: (key) => { try { const v = localStorage.getItem("shared:" + key); return v ? JSON.parse(v) : null; } catch { return null; } },
  setShared: (key, val) => { try { localStorage.setItem("shared:" + key, JSON.stringify(val)); } catch {} },
  listShared: (prefix) => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("shared:" + prefix)) keys.push(k.replace("shared:", ""));
      }
      return keys;
    } catch { return []; }
  },
};


// ── SUPABASE LEADERBOARD ──────────────────────────────────────────────────────
const SUPABASE_URL = "https://lfkzgzvhcnxlvthyervd.supabase.co";
const SUPABASE_KEY = "sb_publishable_do9fzfrjneVwLPIx-qQzbw_gHtZI6nw";

async function sbGetLeaderboard() {
  const res = await fetch(SUPABASE_URL + "/rest/v1/leaderboard?order=points.desc&limit=50", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
  });
  return await res.json();
}

async function sbUpsertLeaderboard(entry) {
  await fetch(SUPABASE_URL + "/rest/v1/leaderboard", {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ username: entry.username, points: entry.points, advisor_name: entry.advisorName, advisor_emoji: entry.advisorEmoji, wins: entry.wins, total: entry.total, updated_at: entry.updatedAt })
  });
}

async function sbGetAdvisors(username) {
  if (!username) return [];
  const res = await fetch(SUPABASE_URL + "/rest/v1/advisors?username=eq." + encodeURIComponent(username) + "&order=created_at.asc", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
  });
  const data = await res.json();
  return (data || []).map(a => ({ id: a.id, name: a.name, emoji: a.emoji, color: a.color, trait: a.trait, shortTrait: a.short_trait }));
}

async function sbSaveAdvisor(username, adv) {
  if (!username) return;
  await fetch(SUPABASE_URL + "/rest/v1/advisors", {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ id: String(adv.id), username, name: adv.name, emoji: adv.emoji, color: adv.color, trait: adv.trait, short_trait: adv.shortTrait })
  });
}

async function sbDeleteAdvisor(id) {
  await fetch(SUPABASE_URL + "/rest/v1/advisors?id=eq." + encodeURIComponent(id), {
    method: "DELETE",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
  });
}

async function sbSaveBet(username, bet) {
  await fetch(SUPABASE_URL + "/rest/v1/bets", {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: bet.id, username: username||"anonymous", question: bet.question,
      winner_advisor: bet.winner, winner_emoji: bet.emoji, prediction: bet.prediction,
      bet: bet.bet, votes: bet.votes||0, is_custom_win: bet.isCustomWin||false,
      outcome: bet.outcome||null, date: bet.date
    })
  });
}

async function sbUpdateBetOutcome(id, outcome) {
  await fetch(SUPABASE_URL + "/rest/v1/bets?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ outcome })
  });
}

// ── API ───────────────────────────────────────────────────────────────────────

// apiKey is passed in from state so every call uses the current key.
async function callClaude(apiKey, system, user, maxTokens = 800) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

async function callClaudeSearch(apiKey, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 3000, tools: [{ type: "web_search_20250305", name: "web_search" }], system, messages: [{ role: "user", content: user }] }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

function parseJ(text) {
  if (!text) return null;
  const s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(s); } catch {}
  const o = s.match(/\{[\s\S]*\}/);
  if (o) { try { return JSON.parse(o[0]); } catch {} }
  return null;
}


// ── KALSHI API ────────────────────────────────────────────────────────────────
async function fetchKalshiMarkets(horizonKey) {
  const res = await fetch("/api/kalshi?horizon=" + horizonKey);
  const data = await res.json();
  return (data.markets || []).filter(m => m.yes_bid > 0);
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── API KEY SCREEN ────────────────────────────────────────────────────────────

function ApiKeyScreen({ onSubmit }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  const S = { C: { fontFamily:"'Cinzel',serif" }, R: { fontFamily:"'Crimson Text',serif", lineHeight:1.65 } };

  const handleSubmit = async () => {
    const key = draft.trim();
    if (!key.startsWith("sk-ant-")) { setError("Key should start with sk-ant-"); return; }
    setTesting(true); setError("");
    try {
      await callClaude(key, "You are a test assistant.", "Reply with the single word: ready", 10);
      onSubmit(key);
    } catch (e) {
      setError("Invalid key or API error: " + e.message);
    }
    setTesting(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#07070a", display:"flex", alignItems:"center", justifyContent:"center", padding:"2rem" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap'); *{box-sizing:border-box;margin:0;padding:0} input{background:#0f0f14;border:1px solid #2a2a3a;color:#ddd;font-family:'Crimson Text',serif;font-size:1rem;outline:none;width:100%;border-radius:6px;padding:.8rem 1rem;transition:border-color .2s} input:focus{border-color:#D4AF37}`}</style>
      <div style={{ maxWidth:"440px", width:"100%", textAlign:"center" }}>
        <div style={{ ...S.C, fontSize:"2.5rem", fontWeight:900, letterSpacing:".15em", color:"#D4AF37", marginBottom:".25rem" }}>ORACLE</div>
        <div style={{ ...S.R, color:"#444", fontStyle:"italic", marginBottom:"2.5rem" }}>Live data. Five minds. One verdict.</div>

        <div style={{ background:"#0a0a0f", border:"1px solid #1e1e28", borderRadius:"12px", padding:"2rem", textAlign:"left" }}>
          <div style={{ ...S.C, fontSize:".6rem", color:"#D4AF37", letterSpacing:".2em", marginBottom:"1.25rem" }}>ENTER YOUR API KEY</div>

          <div style={{ ...S.R, color:"#555", fontSize:".88rem", marginBottom:"1.25rem" }}>
            Oracle uses the Anthropic API directly from your browser. Your key is stored locally in this browser only and never sent anywhere except Anthropic's servers.
          </div>

          <input
            type="password"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="sk-ant-api03-..."
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
          />

          {error && <div style={{ ...S.R, color:"#FF4444", fontSize:".84rem", marginTop:".6rem" }}>⚠️ {error}</div>}

          <button
            onClick={handleSubmit}
            disabled={!draft.trim() || testing}
            style={{ width:"100%", marginTop:"1rem", fontFamily:"'Cinzel',serif", fontSize:".68rem", letterSpacing:".1em", padding:".75rem", borderRadius:"6px", background:draft.trim()&&!testing?"#D4AF37":"#111", color:draft.trim()&&!testing?"#000":"#333", border:"none", cursor:draft.trim()&&!testing?"pointer":"default", transition:"all .2s" }}>
            {testing ? "VERIFYING KEY..." : "ENTER THE ORACLE →"}
          </button>

          <div style={{ marginTop:"1.5rem", borderTop:"1px solid #161620", paddingTop:"1.25rem" }}>
            <div style={{ ...S.C, fontSize:".52rem", color:"#444", letterSpacing:".12em", marginBottom:".6rem" }}>HOW TO GET A KEY</div>
            <div style={{ ...S.R, color:"#555", fontSize:".82rem" }}>
              1. Go to <span style={{ color:"#D4AF37" }}>console.anthropic.com</span><br/>
              2. Sign up or log in<br/>
              3. Go to API Keys → Create Key<br/>
              4. Paste it above
            </div>
            <div style={{ ...S.R, color:"#333", fontSize:".78rem", marginTop:".75rem", fontStyle:"italic" }}>
              Each council session uses ~21 API calls. At standard rates this costs roughly $0.10–0.15 per session.
            </div>
          </div>
        </div>

        <button
          onClick={() => { LS.set("oracle:apiKey", null); }}
          style={{ marginTop:"1rem", background:"transparent", border:"none", color:"#2a2a3a", fontFamily:"'Cinzel',serif", fontSize:".5rem", cursor:"pointer" }}>
          Clear saved key
        </button>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────

export default function App() {
  // ── API KEY GATE ────────────────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState(() => LS.get("oracle:apiKey") || "");

  const handleApiKey = (key) => {
    setApiKey(key);
    LS.set("oracle:apiKey", key);
  };

  // Show key screen if no key
  if (!apiKey) return <ApiKeyScreen onSubmit={handleApiKey} />;

  return <OracleApp apiKey={apiKey} onClearKey={() => { setApiKey(""); LS.set("oracle:apiKey", null); }} />;
}

// ── ORACLE APP (shown once key is set) ────────────────────────────────────────

function OracleApp({ apiKey, onClearKey }) {
  const [tab, setTab] = useState(MAIN_TABS.SCOUT);

  // Scout
  const [scoutBusy,    setScoutBusy]    = useState(false);
  const [scoutData,    setScoutData]    = useState(null);
  const [scoutErr,     setScoutErr]     = useState("");
  const [scoutStep,    setScoutStep]    = useState("");
  const [scoutSubTab,  setScoutSubTab]  = useState("browse");
  const [showSettings, setShowSettings] = useState(false);
  const [riskLevel,    setRiskLevel]    = useState("balanced");
  const [categories,   setCategories]   = useState([]);
  const [scoutPrompt,  setScoutPrompt]  = useState("");
  const [liveSearch,   setLiveSearch]   = useState(false);
  const [horizon,      setHorizon]      = useState("short");
  const [savedMarkets, setSavedMarkets] = useState(() => LS.get("oracle:savedMarkets") || []);

  // Council
  const [phase,     setPhase]     = useState(PHASES.IDLE);
  const [question,  setQuestion]  = useState("");
  const [dialogue,  setDialogue]  = useState([]);
  const [preds,     setPreds]     = useState([]);
  const [winner,    setWinner]    = useState(null);
  const [activeIdx, setActiveIdx] = useState(-1); // -1 = none, "all" = all active (parallel phases)
  const [phaseLbl,  setPhaseLbl]  = useState("");
  const [cTab,      setCTab]      = useState("debate");

  // History & points
  const [history, setHistory] = useState(() => LS.get("oracle:history") || []);
  const [points,  setPoints]  = useState(() => LS.get("oracle:points")  ?? 0);

  // Roster
  const [customAdvisors, setCustomAdvisors] = useState(() => LS.get("oracle:customAdvisors") || []);
  const [activeCustomId, setActiveCustomId] = useState(() => LS.get("oracle:activeCustomId") ?? null);
  const [showBuilder,    setShowBuilder]    = useState(false);
  const [editingId,      setEditingId]      = useState(null);
  const [draftName,      setDraftName]      = useState("");
  const [draftEmoji,     setDraftEmoji]     = useState("🧠");
  const [draftColor,     setDraftColor]     = useState("#FF4444");
  const [draftTrait,     setDraftTrait]     = useState("");
  const [draftShort,     setDraftShort]     = useState("");

  // Leaderboard
  const [lbData,    setLbData]    = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [username,  setUsername]  = useState(() => LS.get("oracle:username") || "");
  const [draftUser, setDraftUser] = useState("");

  const [arbData, setArbData] = useState([]);
  const [arbBusy, setArbBusy] = useState(false);
  const [arbErr, setArbErr] = useState("");
  const logEndRef = useRef(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [dialogue]);

  // ── PERSIST TO LOCALSTORAGE ──────────────────────────────────────────────────
  useEffect(() => { LS.set("oracle:savedMarkets",   savedMarkets);   }, [savedMarkets]);
  useEffect(() => { LS.set("oracle:history",        history);        }, [history]);
  useEffect(() => { LS.set("oracle:points",         points);         }, [points]);
  useEffect(() => { LS.set("oracle:customAdvisors", customAdvisors); }, [customAdvisors]);
  useEffect(() => { LS.set("oracle:activeCustomId", activeCustomId); }, [activeCustomId]);
  useEffect(() => { LS.set("oracle:username",       username);       }, [username]);

  // ── LEADERBOARD (localStorage-backed, swap for real DB in production) ────────
  const loadLeaderboard = useCallback(async () => {
    setLbLoading(true);
    try {
      const data = await sbGetLeaderboard();
      if (Array.isArray(data)) {
        setLbData(data.map(e => ({
          username: e.username, points: e.points,
          advisorName: e.advisor_name, advisorEmoji: e.advisor_emoji,
          wins: e.wins, total: e.total, updatedAt: e.updated_at
        })));
      }
    } catch (_) {}
    setLbLoading(false);
  }, []);

  const pushLeaderboard = useCallback(async (pts) => {
    if (!username) return;
    const adv = customAdvisors.find(a => a.id === activeCustomId);
    const entry = {
      username, points: pts,
      advisorName: adv?.name || "No advisor", advisorEmoji: adv?.emoji || "🧠",
      wins: history.filter(h => h.outcome === "WIN").length,
      total: history.length, updatedAt: new Date().toLocaleDateString(),
    };
    try { await sbUpsertLeaderboard(entry); } catch (_) {}
  }, [username, customAdvisors, activeCustomId, history]);

  useEffect(() => { if (tab === MAIN_TABS.LEADERBOARD) loadLeaderboard(); }, [tab, loadLeaderboard]);

  // ── COUNCIL CONSTRUCTION ─────────────────────────────────────────────────────
  const getCouncil = () => {
    const adv = customAdvisors.find(a => a.id === activeCustomId);
    if (!adv) return DEFAULT_COUNCIL;
    return [...DEFAULT_COUNCIL.slice(0, 4), { id: 4, name: adv.name, emoji: adv.emoji, color: adv.color, bg: "#0a0a0a", trait: adv.trait, shortTrait: adv.shortTrait || adv.name, isCustom: true }];
  };

  // ── SCOUT ─────────────────────────────────────────────────────────────────────
  const saveMarket   = (m) => setSavedMarkets(p => p.find(s => s.title === m.title) ? p : [{ ...m, savedAt: new Date().toLocaleDateString() }, ...p]);
  const unsaveMarket = (t) => setSavedMarkets(p => p.filter(m => m.title !== t));
  const isSaved      = (m) => savedMarkets.some(s => s.title === m.title);

  const runArbitrage = async () => {
    setArbBusy(true); setArbData([]); setArbErr("");
    try {
      // Fetch from both platforms in parallel
      const [kalshiRes, polyRes] = await Promise.all([
        fetch('/api/kalshi?horizon=all').catch(() => null),
        fetch('/api/polymarket').catch(() => null),
      ]);

      const kalshiJson = kalshiRes ? await kalshiRes.json() : {};
      const polyJson = polyRes ? await polyRes.json() : [];

      const kalshiMarkets = (kalshiJson.markets || [])
        .filter(m => m.status === 'open' && m.yes_bid > 0)
        .slice(0, 80)
        .map(m => ({ platform: 'Kalshi', title: m.title, odds: m.yes_bid, ticker: m.ticker, url: 'https://kalshi.com/markets/' + m.event_ticker }));

      const polyMarkets = (Array.isArray(polyJson) ? polyJson : [])
        .filter(m => m.active && m.outcomePrices)
        .slice(0, 80)
        .map(m => {
          let price = 50;
          try { price = Math.round(parseFloat(JSON.parse(m.outcomePrices)[0]) * 100); } catch(_) {}
          return { platform: 'Polymarket', title: m.question || m.title || '', odds: price, url: 'https://polymarket.com/event/' + m.slug };
        });

      if (!kalshiMarkets.length && !polyMarkets.length) throw new Error("Could not fetch market data. Try again.");

      // Ask Claude to find arbitrage opportunities
      const kSummary = kalshiMarkets.map(m => `[Kalshi] ${m.title}: YES ${m.odds}%`).join('\n');
      const pSummary = polyMarkets.map(m => `[Polymarket] ${m.title}: YES ${m.odds}%`).join('\n');

      const sys = "You are an arbitrage analyst for prediction markets. Find markets that appear to cover the same event but have different odds across platforms, OR find logical inconsistencies within a single platform. JSON only.";
      const usr = `Find the top 5 arbitrage or mispricing opportunities from these markets.
For cross-platform: same event priced differently.
For single-platform: related markets whose odds are logically inconsistent.

Return: [{"title":"short description","type":"Cross-Platform OR Internal","kalshiOdds":"X% or N/A","polyOdds":"Y% or N/A","discrepancy":"Xpp difference","opportunity":"1 sentence on how to exploit","confidence":"High/Medium/Low","kalshiTitle":"...","polyTitle":"..."}]

KALSHI MARKETS:
${kSummary}

POLYMARKET MARKETS:
${pSummary}

Raw JSON array only.`;

      const raw = await callClaude(apiKey, sys, usr, 2000);
      const match = raw.replace(/\`\`\`json|\`\`\`/g, '').trim().match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Could not analyze markets. Try again.");
      const results = JSON.parse(match[0]);
      
      // Attach URLs
      const withUrls = results.map(r => ({
        ...r,
        kalshiUrl: kalshiMarkets.find(m => m.title.toLowerCase().includes(r.kalshiTitle?.toLowerCase().slice(0,15)))?.url || '',
        polyUrl: polyMarkets.find(m => m.title.toLowerCase().includes(r.polyTitle?.toLowerCase().slice(0,15)))?.url || '',
      }));
      
      setArbData(withUrls);
    } catch(e) { setArbErr(e.message || "Unknown error."); }
    setArbBusy(false);
  };

  const runScout = async () => {
    setScoutBusy(true); setScoutData(null); setScoutErr("");
    const today = new Date();
    const ts = fmtDate(today);
    const rc = RISK_CONFIGS[riskLevel];
    const h = HORIZONS.find(x => x.key === horizon) || HORIZONS[1];
    const catF = categories.length > 0 ? "Categories only: " + categories.join(", ") + "." : "";
    try {
      setScoutStep("Fetching live Kalshi markets...");
      let kalshiMarkets = [];
      try {
        kalshiMarkets = await fetchKalshiMarkets(horizon);
      } catch (_) {}

      setScoutStep("Selecting best markets...");

      let prompt = "";
      if (kalshiMarkets.length > 0) {
        // Use real Kalshi data
        const sample = kalshiMarkets
          .sort(() => Math.random() - 0.5)
          .slice(0, 30)
          .map(m => `- ${m.title} | YES at ${m.yes_bid}% | closes: ${new Date(m.close_time).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})} | ticker: ${m.ticker}`)
          .join("\n");

        prompt = `Today: ${ts}. Pick 4 markets from this list that best match: ${rc.instruction} ${catF}
For each return JSON with fields: title, question, category, currentOdds (use exact yes_bid value as percent), closes, whyInteresting, councilPrompt, ticker.
Raw JSON array only. Use EXACT yes_bid values as odds. Markets:
${sample}`;
      } else {
        // Fallback: generate without real data
        prompt = `Today: ${ts}. Generate 4 Kalshi prediction markets closing ${h.closes}. ${rc.instruction} ${catF}
Return: [{"title":"max 8 words","question":"Will X?","category":"Crypto","currentOdds":"YES at 55%","closes":"specific date","whyInteresting":"1 sentence.","councilPrompt":"Kalshi: Will X? YES 55%. YES or NO bet."}]
Raw JSON array only.`;
      }

      const jSys = "JSON API. Output raw valid JSON array only. No markdown.";
      const raw = await callClaude(apiKey, jSys, prompt, 1500);
      const match = raw.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Could not generate markets. Try again.");
      const arr = JSON.parse(match[0]);
      if (!arr.length) throw new Error("Could not generate markets. Try again.");
      const norm = (m, i) => ({ title: m.title||"Market "+(i+1), question: m.question||"", category: m.category||"Other", currentOdds: m.currentOdds||"YES at 50%", closes: m.closes||"TBD", whyInteresting: m.whyInteresting||"", councilPrompt: m.councilPrompt||("Kalshi: " + m.title + ". " + m.currentOdds + ". YES/NO bet."), ticker: m.ticker||"" });
      setScoutData(arr.slice(0, 4).map(norm));
    } catch (e) { setScoutErr(e.message || "Unknown error. Try again."); }
    setScoutStep(""); setScoutBusy(false);
  };



  const pickMarket = (m) => { setQuestion(m.councilPrompt); resetCouncil(); setTab(MAIN_TABS.COUNCIL); };

  // ── COUNCIL ───────────────────────────────────────────────────────────────────
  const resetCouncil = () => { setPhase(PHASES.IDLE); setDialogue([]); setPreds([]); setWinner(null); setActiveIdx(-1); setCTab("debate"); };
  const log = (e) => setDialogue(p => [...p, { ...e, k: Math.random() }]);

  const runCouncil = async () => {
    if (!question.trim() || phase !== PHASES.IDLE) return;
    const q = question.trim();
    const COUNCIL = getCouncil();
    setDialogue([]); setPreds([]); setWinner(null); setCTab("debate");

    // ── Phase 0: web search ──────────────────────────────────────────────────
    setPhase(PHASES.SEARCHING); setPhaseLbl("Searching for live data...");
    log({ type:"phase", text:"🔍 PHASE 0 — LIVE BRIEFING" });
    log({ type:"thinking", text:"Searching the web for current prices and news..." });
    let ctx = "No live data available.";
    try {
      const r = await callClaudeSearch(apiKey, "You are a market research briefer. Find current real-time data. Write concise bullet-point briefing with specific numbers, prices, names, dates from the past 7 days.", "Today is "+fmtDate(new Date())+". Live data on: "+q);
      if (r) ctx = r;
    } catch (_) {}
    log({ type:"briefing", text:ctx });

    // ── Phase 1: PARALLEL predictions ────────────────────────────────────────
    // All 7 advisors predict simultaneously — cuts this phase from ~50s to ~10s
    setPhase(PHASES.PREDICTING); setPhaseLbl("Council deliberating...");
    setActiveIdx("all"); // signal all advisors are active
    log({ type:"phase", text:"📋 PHASE 1 — PREDICTIONS (parallel)" });
    log({ type:"thinking", text:"All 7 advisors forming predictions simultaneously..." });

    const predictions = [];
    for (let i = 0; i < COUNCIL.length; i++) {
      const a = COUNCIL[i]; setActiveIdx(i);
      log({ type:"thinking", text:a.name+" is forming a prediction..." });
      const sys = "You are "+a.name+". Personality: "+a.trait+"\nJSON only: {\"prediction\":\"one sentence\",\"bet\":\"YES/NO — specific claim with numbers/dates\",\"confidence\":70,\"reasoning\":\"2 sentences\"}";
      const raw = await callClaude(apiKey, sys, "Question: \""+q+"\"\n\nLIVE DATA:\n"+ctx, 400);
      const p = parseJ(raw) || { prediction:"Analysis inconclusive.", bet:"NO — insufficient data", confidence:50, reasoning:"Could not analyze." };
      predictions.push({ ...p, id:a.id });
      log({ type:"pred", id:a.id, ...p });
      await new Promise(r => setTimeout(r, 12000));
    }
    setActiveIdx(-1);

    // Log all predictions in order
    predictions.forEach(p => log({ type:"pred", id:p.id, ...p }));
    setActiveIdx(-1);
    setPreds(predictions);

    // ── Phase 2: PARALLEL arguments ───────────────────────────────────────────
    // All 7 advisors argue simultaneously — cuts this phase from ~50s to ~10s
    setPhase(PHASES.ARGUING); setPhaseLbl("Making their case...");
    setActiveIdx("all");
    log({ type:"phase", text:"🗣️ PHASE 2 — ARGUMENTS (parallel)" });
    log({ type:"thinking", text:"All 7 advisors preparing their arguments simultaneously..." });

    const predSum = predictions.map(p => COUNCIL[p.id].name+": \""+p.prediction+"\" | "+p.bet+" | "+p.reasoning).join("\n\n");

    const argPromises = COUNCIL.map(async (a, i) => {
      const sys = "You are "+a.name+". Personality: "+a.trait+"\nArgue passionately for YOUR prediction. Be direct, in-character, use specific data. 3-5 sentences. No JSON.";
      const argText = await callClaude(apiKey, sys, "Question: \""+q+"\"\nYour bet: "+predictions[i].bet+"\nAll predictions:\n"+predSum+"\nArgue why yours is best.", 500);
      return { id:a.id, arg:argText.trim() };
    });

    const argResults = await Promise.allSettled(argPromises);
    const argsList = argResults.map((r, i) =>
      r.status === "fulfilled" ? r.value : { id:i, arg:"I stand by my analysis." }
    );

    argsList.forEach(a => log({ type:"arg", id:a.id, text:a.arg }));
    setActiveIdx(-1);

    // ── Phase 3: SEQUENTIAL voting ────────────────────────────────────────────
    // Voting stays sequential — each advisor should be able to react to the full
    // argument set and their vote is a deliberate, visible moment.
    setPhase(PHASES.VOTING); setPhaseLbl("Casting votes...");
    log({ type:"phase", text:"🗳️ PHASE 3 — THE VOTE" });
    const tally = {}; COUNCIL.forEach(a => { tally[a.id] = 0; });

    for (let i = 0; i < COUNCIL.length; i++) {
      const a = COUNCIL[i]; setActiveIdx(i);
      log({ type:"thinking", text:a.name+" is casting their vote..." });
      const sys = "You are "+a.name+". Personality: "+a.trait+"\nVote for the BEST prediction — NOT yourself (not ID "+i+"). JSON only: {\"vote\":ID_NUMBER,\"reason\":\"2-3 sentences in character\"}";
      const raw = await callClaude(apiKey, sys, "Question: \""+q+"\"\"\nPredictions:\n"+predSum+"\nVote. Not yourself ID "+i+".", 300);
      const v = parseJ(raw);
      let to = v ? parseInt(v.vote) : -1;
      if (isNaN(to)||to===i||to<0||to>=COUNCIL.length) to = predictions.find(p=>p.id!==i)?.id ?? (i===0?1:0);
      tally[to]++;
      log({ type:"vote", from:i, to, reason:v?.reason||"Strong analysis." });
      await new Promise(r => setTimeout(r, 5000));
    }
    setActiveIdx(-1);

    const winnerId = parseInt(Object.entries(tally).sort((a,b)=>b[1]-a[1])[0][0]);
    const wp = predictions.find(p=>p.id===winnerId);
    const winAdv = COUNCIL[winnerId];
    const w = { ...wp, advisor:winAdv, votes:tally[winnerId], tally, isCustomWin:!!winAdv.isCustom };
    setWinner(w);
    setPhase(PHASES.RESULT); setPhaseLbl("");
    log({ type:"winner", id:winnerId, votes:tally[winnerId], isCustom:!!winAdv.isCustom });
    setCTab("result");

    if (winAdv.isCustom) {
      const np = points + 2;
      setPoints(np);
      pushLeaderboard(np);
    }
  };

  const saveBet = () => {
    if (!winner) return;
    setHistory(h => [{ question, winner:winner.advisor.name, emoji:winner.advisor.emoji, prediction:winner.prediction, bet:winner.bet, votes:winner.votes, date:new Date().toLocaleDateString(), outcome:null, isCustomWin:winner.isCustomWin }, ...h]);
  };

  const resolveOutcome = (i, newOutcome) => {
    const h2 = [...history];
    const prev = h2[i].outcome;
    h2[i].outcome = newOutcome;
    setHistory(h2);
    if (h2[i].isCustomWin) {
      let d = 0;
      if (prev==="WIN") d-=5; else if (prev==="LOSS") d-=1; else if (prev===null) d-=2;
      if (newOutcome==="WIN") d+=5; else if (newOutcome==="LOSS") d+=1; else if (newOutcome===null) d+=2;
      const np = Math.max(0, points+d);
      setPoints(np);
      pushLeaderboard(np);
    }
  };

  const isRunning = [PHASES.SEARCHING,PHASES.PREDICTING,PHASES.ARGUING,PHASES.VOTING].includes(phase);
  const allActive = activeIdx === "all";
  const COUNCIL = getCouncil();

  // ── ROSTER ────────────────────────────────────────────────────────────────────
  const openBuilder = (existing = null) => {
    setEditingId(existing?.id ?? null);
    setDraftName(existing?.name ?? "");
    setDraftEmoji(existing?.emoji ?? "🧠");
    setDraftColor(existing?.color ?? "#FF4444");
    setDraftTrait(existing?.trait ?? "");
    setDraftShort(existing?.shortTrait ?? "");
    setShowBuilder(true);
  };

  const saveAdvisor = () => {
    if (!draftName.trim()||!draftTrait.trim()) return;
    const adv = { id:editingId??Date.now(), name:draftName.trim(), emoji:draftEmoji, color:draftColor, trait:draftTrait.trim(), shortTrait:draftShort.trim()||draftName.trim() };
    setCustomAdvisors(p => editingId ? p.map(a => a.id===editingId?adv:a) : [...p, adv]);
    setShowBuilder(false);
  };

  const deleteAdvisor = (id) => { setCustomAdvisors(p=>p.filter(a=>a.id!==id)); if (activeCustomId===id) setActiveCustomId(null); };

  // ── STYLES ────────────────────────────────────────────────────────────────────
  const S = {
    page: { minHeight:"100vh", background:"#07070a", color:"#ddd", fontFamily:"Georgia,serif" },
    C:    { fontFamily:"'Cinzel',serif" },
    R:    { fontFamily:"'Crimson Text',serif", lineHeight:1.65 },
    body: { maxWidth:"900px", margin:"0 auto", padding:"1.5rem 1rem" },
  };

  const Btn = ({ onClick, disabled, children, gold, small, danger }) => (
    <button onClick={onClick} disabled={disabled} style={{ fontFamily:"'Cinzel',serif", letterSpacing:".08em", cursor:disabled?"default":"pointer", fontSize:small?".56rem":".66rem", padding:small?".3rem .7rem":".55rem 1.2rem", borderRadius:"5px", border:danger?"1px solid #FF444440":"none", transition:"all .2s", background:disabled?"#111":danger?"#FF444415":gold?"#D4AF37":"#1a1a25", color:disabled?"#333":danger?"#FF4444":gold?"#000":"#aaa" }}>
      {children}
    </button>
  );

  const Tag = ({ children, color }) => (
    <span style={{ background:color+"15", border:"1px solid "+color+"35", color, borderRadius:"3px", padding:"1px 7px", fontFamily:"'Cinzel',serif", fontSize:".5rem", letterSpacing:".06em" }}>{children}</span>
  );

  const activeAdv = customAdvisors.find(a => a.id === activeCustomId);

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        textarea,input[type=text],input[type=password]{background:#0f0f14;border:1px solid #2a2a3a;color:#ddd;font-family:'Crimson Text',serif;font-size:.95rem;outline:none;resize:none;width:100%;border-radius:6px;padding:.7rem .9rem;transition:border-color .2s}
        textarea:focus,input[type=text]:focus,input[type=password]:focus{border-color:#D4AF37}
        button{cursor:pointer;transition:all .2s;border:none}
        .pulse{animation:pulse 1.2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        .fin{animation:fin .3s ease}
        @keyframes fin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        .gold-glow{box-shadow:0 0 30px rgba(212,175,55,.2),0 0 70px rgba(212,175,55,.08)}
        .card{transition:all .2s;border:1px solid #1e1e28;border-radius:8px;background:#0a0a0f}
        .card:hover{border-color:#D4AF37 !important;transform:translateY(-1px)}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0f0f14}::-webkit-scrollbar-thumb{background:#2a2a3a}
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{ background:"linear-gradient(180deg,#0d0b05 0%,#07070a 100%)", borderBottom:"1px solid #161620", padding:"1.25rem 1rem" }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".75rem", flexWrap:"wrap", gap:".5rem" }}>
            <div>
              <div style={{ ...S.C, fontSize:"1.8rem", fontWeight:900, letterSpacing:".12em", color:"#D4AF37", lineHeight:1 }}>ORACLE</div>
              <div style={{ ...S.R, color:"#444", fontStyle:"italic", fontSize:".85rem" }}>Live data. Five minds. One verdict.</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
              {activeAdv && (
                <div style={{ background:"#0f0f14", border:"1px solid "+activeAdv.color+"40", borderRadius:"8px", padding:".4rem .75rem", textAlign:"center" }}>
                  <div style={{ fontSize:"1.1rem" }}>{activeAdv.emoji}</div>
                  <div style={{ ...S.C, fontSize:".46rem", color:activeAdv.color, letterSpacing:".06em" }}>ACTIVE</div>
                </div>
              )}
              {username && (
                <div style={{ textAlign:"right" }}>
                  <div style={{ ...S.C, fontSize:".5rem", color:"#444", letterSpacing:".15em" }}>ORACLE SCORE</div>
                  <div style={{ ...S.C, fontSize:"1.4rem", color:"#D4AF37", lineHeight:1 }}>{points}</div>
                  <div style={{ ...S.R, fontSize:".75rem", color:"#555" }}>{username}</div>
                </div>
              )}
              <button onClick={onClearKey} title="Change API key" style={{ background:"transparent", border:"1px solid #1e1e28", color:"#333", borderRadius:"4px", padding:"4px 8px", fontFamily:"'Cinzel',serif", fontSize:".48rem", cursor:"pointer" }}>🔑</button>
            </div>
          </div>

          {tab === MAIN_TABS.COUNCIL && (
            <div style={{ display:"flex", justifyContent:"center", gap:".6rem", marginBottom:".5rem", flexWrap:"wrap" }}>
              {phase===PHASES.SEARCHING
                ? <div style={{ ...S.C, fontSize:".6rem", letterSpacing:".2em", color:"#4488FF" }} className="pulse">🔍 SEARCHING LIVE DATA...</div>
                : COUNCIL.map(a => (
                    <div key={a.id} title={a.name} style={{ fontSize:"1.3rem", transition:"all .3s",
                      opacity: allActive ? 1 : activeIdx===a.id ? 1 : isRunning ? .15 : .55,
                      filter: allActive ? "drop-shadow(0 0 6px "+a.color+")" : activeIdx===a.id ? "drop-shadow(0 0 8px "+a.color+")" : "none",
                      transform: allActive ? "scale(1.1)" : activeIdx===a.id ? "scale(1.4)" : "scale(1)",
                    }}>{a.emoji}</div>
                  ))
              }
            </div>
          )}
          {isRunning && phase!==PHASES.SEARCHING && <div style={{ ...S.C, fontSize:".58rem", letterSpacing:".2em", color:"#D4AF37", textAlign:"center", marginBottom:".5rem" }} className="pulse">{phaseLbl}</div>}

          <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap" }}>
            {[
              [MAIN_TABS.SCOUT,       "🎯 SCOUT"                        ],
              [MAIN_TABS.COUNCIL,     "⚖️ COUNCIL"                      ],
              [MAIN_TABS.HISTORY,     "📋 HISTORY ("+history.length+")" ],
              [MAIN_TABS.ROSTER,      "🧬 ROSTER"                       ],
              [MAIN_TABS.LEADERBOARD, "🏆 LEADERBOARD"                  ],
              [MAIN_TABS.ARBITRAGE,   "⚡ ARB"                           ],
            ].map(([k,l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ ...S.C, fontSize:".56rem", letterSpacing:".1em", padding:".35rem .8rem", borderRadius:"4px", background:tab===k?"#D4AF37":"transparent", color:tab===k?"#000":"#555", border:tab===k?"none":"1px solid #1e1e28", cursor:"pointer" }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={S.body}>

        {/* ══════════════════ SCOUT ══════════════════ */}
        {tab===MAIN_TABS.SCOUT && (
          <div>
            <div style={{ display:"flex", gap:".4rem", marginBottom:"1.25rem" }}>
              {[["browse","🎯 Browse"],["saved","🔖 Saved ("+savedMarkets.length+")"]].map(([k,l]) => (
                <button key={k} onClick={() => setScoutSubTab(k)} style={{ ...S.C, fontSize:".58rem", letterSpacing:".1em", padding:".38rem .85rem", borderRadius:"4px", background:scoutSubTab===k?"#D4AF37":"transparent", color:scoutSubTab===k?"#000":"#555", border:scoutSubTab===k?"none":"1px solid #1e1e28", cursor:"pointer" }}>{l}</button>
              ))}
            </div>

            {scoutSubTab==="saved" && (
              <div>
                {savedMarkets.length===0 ? (
                  <div style={{ textAlign:"center", padding:"3rem", border:"1px dashed #1a1a25", borderRadius:"10px" }}>
                    <div style={{ fontSize:"2rem", opacity:.15, marginBottom:".5rem" }}>🔖</div>
                    <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".15em" }}>NO SAVED MARKETS</div>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".25rem" }}>
                      <div style={{ ...S.C, fontSize:".54rem", color:"#555", letterSpacing:".12em" }}>{savedMarkets.length} SAVED</div>
                      <Btn small danger onClick={() => setSavedMarkets([])}>CLEAR ALL</Btn>
                    </div>
                    {savedMarkets.map((m,i) => {
                      const cc=CAT_COLORS[m.category]||"#888";
                      const cl=new Date(m.closes), td=new Date(), d14=new Date(td); d14.setDate(td.getDate()+14); const d90=new Date(td); d90.setMonth(td.getMonth()+3);
                      const hz=isNaN(cl)?HORIZONS[1]:cl<=d14?HORIZONS[0]:cl<=d90?HORIZONS[1]:HORIZONS[2];
                      return (
                        <div key={i} className="card fin" style={{ overflow:"hidden" }}>
                          <div style={{ height:"2px", background:hz.color }} />
                          <div style={{ padding:"1rem", display:"flex", justifyContent:"space-between", gap:".75rem", alignItems:"flex-start" }}>
                            <div style={{ flex:1 }}>
                              <div style={{ display:"flex", gap:".4rem", marginBottom:".3rem", flexWrap:"wrap", alignItems:"center" }}>
                                <Tag color={cc}>{(m.category||"OTHER").toUpperCase()}</Tag>
                                {m.currentOdds && (() => {
                                  const pct = parseInt(m.currentOdds);
                                  const color = pct >= 65 ? "#00C896" : pct >= 40 ? "#D4AF37" : "#FF4444";
                                  const label = isNaN(pct) ? m.currentOdds : (pct + "% YES");
                                  return <span style={{ background:color+"20", border:"1px solid "+color+"60", color, borderRadius:"4px", padding:"2px 9px", fontFamily:"'Cinzel',serif", fontSize:".54rem", fontWeight:"bold", letterSpacing:".04em" }}>{label}</span>;
                                })()}
                                <span style={{ color:hz.color, fontFamily:"'Crimson Text',serif", fontSize:".78rem", opacity:.8 }}>closes {m.closes}</span>
                              </div>
                              <div style={{ ...S.C, fontSize:".76rem", color:"#e0e0e0", marginBottom:".15rem" }}>{m.title}</div>
                              <div style={{ ...S.R, fontSize:".84rem", color:"#666", fontStyle:"italic" }}>{m.question}</div>
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", gap:".35rem", flexShrink:0 }}>
                              <Btn small gold onClick={() => pickMarket(m)}>ANALYZE</Btn>
                              <Btn small danger onClick={() => unsaveMarket(m.title)}>REMOVE</Btn>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {scoutSubTab==="browse" && (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1rem", flexWrap:"wrap", gap:".75rem" }}>
                  <div>
                    <div style={{ ...S.C, fontSize:".9rem", color:"#D4AF37", letterSpacing:".08em", marginBottom:".25rem" }}>MARKET SCOUT</div>
                    <div style={{ ...S.R, color:"#555", fontSize:".85rem" }}>{RISK_CONFIGS[riskLevel].label} · {categories.length>0?categories.join(", "):"All categories"}</div>
                  </div>
                  <div style={{ display:"flex", gap:".5rem" }}>
                    <button onClick={() => setShowSettings(s=>!s)} style={{ ...S.C, fontSize:".58rem", letterSpacing:".08em", padding:".45rem .95rem", borderRadius:"5px", background:showSettings?"#1a1a25":"transparent", color:showSettings?"#D4AF37":"#555", border:"1px solid "+(showSettings?"#D4AF37":"#1e1e28"), cursor:"pointer" }}>⚙️ SETTINGS</button>
                    <button onClick={() => setLiveSearch(s=>!s)} style={{ fontFamily:"'Cinzel',serif", fontSize:".58rem", letterSpacing:".08em", padding:".45rem .95rem", borderRadius:"5px", background:liveSearch?"#4488FF20":"transparent", color:liveSearch?"#4488FF":"#555", border:"1px solid "+(liveSearch?"#4488FF":"#1e1e28"), cursor:"pointer" }}>🌐 {liveSearch?"LIVE ON":"LIVE OFF"}</button>
                    <Btn gold onClick={runScout} disabled={scoutBusy}>{scoutBusy?"SCOUTING...":"🎯 FIND MARKETS"}</Btn>
                  </div>
                </div>

                {/* HORIZON SELECTOR */}
                <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap", marginBottom:"1rem" }}>
                  {HORIZONS.map(h => (
                    <button key={h.key} onClick={() => setHorizon(h.key)} style={{ fontFamily:"'Cinzel',serif", fontSize:".56rem", letterSpacing:".08em", padding:".38rem .9rem", borderRadius:"4px", background:horizon===h.key?h.color+"20":"transparent", color:horizon===h.key?h.color:"#555", border:"1px solid "+(horizon===h.key?h.color:"#1e1e28"), cursor:"pointer" }}>{h.icon} {h.label}</button>
                  ))}
                </div>

                {showSettings && (
                  <div className="fin" style={{ background:"#0a0a0f", border:"1px solid #1e1e28", borderRadius:"10px", padding:"1.25rem", marginBottom:"1.25rem" }}>
                    <div style={{ ...S.C, fontSize:".58rem", color:"#D4AF37", letterSpacing:".2em", marginBottom:"1rem" }}>SCOUT SETTINGS</div>
                    <div style={{ marginBottom:"1rem" }}>
                      <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".45rem" }}>RISK TOLERANCE</div>
                      <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap" }}>
                        {Object.entries(RISK_CONFIGS).map(([k,v]) => (
                          <button key={k} onClick={() => setRiskLevel(k)} style={{ ...S.C, fontSize:".56rem", padding:".32rem .78rem", borderRadius:"4px", background:riskLevel===k?v.color+"20":"transparent", color:riskLevel===k?v.color:"#444", border:"1px solid "+(riskLevel===k?v.color:"#1e1e28"), cursor:"pointer" }}>{v.label}</button>
                        ))}
                      </div>
                      <div style={{ ...S.R, fontSize:".78rem", color:"#444", marginTop:".3rem", fontStyle:"italic" }}>{RISK_CONFIGS[riskLevel].desc}</div>
                    </div>
                    <div style={{ marginBottom:"1rem" }}>
                      <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".45rem" }}>CATEGORIES <span style={{ color:"#333" }}>(blank = all)</span></div>
                      <div style={{ display:"flex", gap:".35rem", flexWrap:"wrap" }}>
                        {ALL_CATEGORIES.map(cat => { const cc=CAT_COLORS[cat]||"#888"; const sel=categories.includes(cat); return (
                          <button key={cat} onClick={() => setCategories(p => sel?p.filter(c=>c!==cat):[...p,cat])} style={{ ...S.C, fontSize:".52rem", padding:"2px 8px", borderRadius:"4px", background:sel?cc+"20":"transparent", color:sel?cc:"#444", border:"1px solid "+(sel?cc:"#1e1e28"), cursor:"pointer" }}>{cat}</button>
                        ); })}
                      </div>
                    </div>
                    <div style={{ marginBottom:"1rem" }}>
                      <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".45rem" }}>CUSTOM INSTRUCTIONS</div>
                      <textarea rows={2} value={scoutPrompt} onChange={e => setScoutPrompt(e.target.value)} placeholder='e.g. "only Elon Musk markets" or "NBA playoffs only"' />
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <Btn small onClick={() => { setRiskLevel("balanced"); setCategories([]); setScoutPrompt(""); }}>RESET</Btn>
                      <Btn gold onClick={() => { setShowSettings(false); runScout(); }}>APPLY & SCOUT →</Btn>
                    </div>
                  </div>
                )}

                {scoutBusy && (
                  <div style={{ textAlign:"center", padding:"3rem" }}>
                    <div style={{ ...S.C, fontSize:".62rem", letterSpacing:".2em", color:"#4488FF" }} className="pulse">SCOUTING KALSHI...</div>
                    <div style={{ ...S.R, color:"#444", marginTop:".5rem", fontStyle:"italic" }}>{scoutStep}</div>
                  </div>
                )}
                {scoutErr && (
                  <div style={{ background:"#1a0000", border:"1px solid #FF444433", borderRadius:"6px", padding:"1rem", marginBottom:"1rem" }}>
                    <div style={{ ...S.R, color:"#FF4444", marginBottom:".5rem" }}>⚠️ {scoutErr}</div>
                    <Btn small danger onClick={runScout}>TRY AGAIN</Btn>
                  </div>
                )}

                {scoutData && (
                  <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }} className="fin">
                    {(Array.isArray(scoutData) ? scoutData : []).map((m, i) => {
                      const h = HORIZONS.find(x => x.key === horizon) || HORIZONS[1];
                      const cc = CAT_COLORS[m.category] || "#888";
                      const saved = isSaved(m);
                      return (
                        <div key={i} className="card fin" onClick={() => pickMarket(m)} style={{ padding:"1rem", cursor:"pointer" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", gap:".75rem", alignItems:"flex-start" }}>
                            <div style={{ flex:1 }}>
                              <div style={{ display:"flex", gap:".4rem", marginBottom:".3rem", flexWrap:"wrap", alignItems:"center" }}>
                                <Tag color={cc}>{(m.category||"OTHER").toUpperCase()}</Tag>
                                {m.currentOdds && (() => {
                                  const pct = parseInt(m.currentOdds);
                                  const color = pct >= 65 ? "#00C896" : pct >= 40 ? "#D4AF37" : "#FF4444";
                                  const label = isNaN(pct) ? m.currentOdds : (pct + "% YES");
                                  return <span style={{ background:color+"20", border:"1px solid "+color+"60", color, borderRadius:"4px", padding:"2px 9px", fontFamily:"'Cinzel',serif", fontSize:".54rem", fontWeight:"bold", letterSpacing:".04em" }}>{label}</span>;
                                })()}
                                {m.closes && <span style={{ color:h.color, fontFamily:"'Crimson Text',serif", fontSize:".78rem", opacity:.8 }}>closes {m.closes}</span>}
                              </div>
                              <div style={{ ...S.C, fontSize:".76rem", color:"#e0e0e0", marginBottom:".2rem" }}>{m.title}</div>
                              <div style={{ ...S.R, fontSize:".84rem", color:"#666", fontStyle:"italic", marginBottom:m.whyInteresting?".2rem":0 }}>{m.question}</div>
                              {m.whyInteresting && <div style={{ ...S.R, fontSize:".78rem", color:"#555" }}>{m.whyInteresting}</div>}
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", gap:".35rem", flexShrink:0, alignSelf:"center" }}>
                              <div style={{ background:h.color, color:"#000", padding:".35rem .85rem", borderRadius:"4px", fontFamily:"'Cinzel',serif", fontSize:".56rem", fontWeight:"bold", textAlign:"center" }}>ANALYZE</div>
                              <div onClick={e => { e.stopPropagation(); saved?unsaveMarket(m.title):saveMarket(m); }} style={{ background:saved?"#D4AF3715":"transparent", border:"1px solid "+(saved?"#D4AF37":"#2a2a3a"), color:saved?"#D4AF37":"#444", padding:".28rem .85rem", borderRadius:"4px", fontFamily:"'Cinzel',serif", fontSize:".5rem", cursor:"pointer", textAlign:"center" }}>
                                {saved?"🔖 SAVED":"🔖 SAVE"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!scoutBusy && !scoutData && !scoutErr && (
                  <div style={{ textAlign:"center", padding:"4rem 2rem", border:"1px dashed #1a1a25", borderRadius:"10px" }}>
                    <div style={{ display:"flex", justifyContent:"center", gap:"1.5rem", marginBottom:"1rem", opacity:.15 }}>
                      {HORIZONS.map(h => <span key={h.key} style={{ fontSize:"2rem" }}>{h.icon}</span>)}
                    </div>
                    <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".2em", marginBottom:".5rem" }}>NO MARKETS LOADED</div>
                    <div style={{ ...S.R, color:"#444", fontStyle:"italic" }}>Click "Find Markets" to scout Kalshi across all time horizons.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ COUNCIL ══════════════════ */}
        {tab===MAIN_TABS.COUNCIL && (
          <div>
            {phase===PHASES.IDLE && (
              <div className="fin" style={{ marginBottom:"1.5rem" }}>
                <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".2em", marginBottom:".5rem" }}>QUESTION FOR THE COUNCIL</div>
                <textarea rows={4} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Enter a question, or pick one from Scout..." onKeyDown={e => e.key==="Enter"&&e.ctrlKey&&runCouncil()} />
                <div style={{ display:"flex", gap:".75rem", marginTop:".75rem", flexWrap:"wrap", alignItems:"center" }}>
                  <Btn gold onClick={runCouncil} disabled={!question.trim()}>CONVENE THE COUNCIL</Btn>
                  <Btn onClick={() => setTab(MAIN_TABS.SCOUT)}>🎯 SCOUT</Btn>
                  {!activeAdv && <div style={{ ...S.R, fontSize:".8rem", color:"#333", fontStyle:"italic" }}>💡 Add an advisor in Roster to earn points</div>}
                </div>
              </div>
            )}

            {phase!==PHASES.IDLE && (
              <div style={{ display:"flex", gap:".4rem", marginBottom:"1.25rem", flexWrap:"wrap", alignItems:"center" }}>
                {[["debate","💬 DEBATE",false],["predictions","🔮 PREDICTIONS",preds.length===0],["result","🏆 RESULT",!winner]].map(([k,l,dis]) => (
                  <button key={k} onClick={() => !dis&&setCTab(k)} style={{ ...S.C, fontSize:".56rem", letterSpacing:".1em", padding:".38rem .82rem", borderRadius:"4px", background:cTab===k?"#D4AF37":"transparent", color:cTab===k?"#000":"#555", border:cTab===k?"none":"1px solid #1e1e28", opacity:dis?.3:1, cursor:dis?"default":"pointer" }}>{l}</button>
                ))}
                {phase===PHASES.RESULT && <Btn small onClick={() => { resetCouncil(); setQuestion(""); }} style={{ marginLeft:"auto" }}>NEW QUESTION</Btn>}
              </div>
            )}

            {/* DEBATE LOG */}
            {cTab==="debate" && dialogue.length>0 && (
              <div style={{ background:"#0a0a0f", border:"1px solid #161620", borderRadius:"8px", padding:"1.25rem", maxHeight:"65vh", overflowY:"auto" }}>
                {dialogue.map((e,i) => {
                  if (e.type==="phase") return <div key={i} className="fin" style={{ ...S.C, fontSize:".56rem", letterSpacing:".2em", color:"#D4AF37", padding:i>0?"1.2rem 0 .6rem":"0 0 .6rem", borderTop:i>0?"1px solid #161620":"none" }}>{e.text}</div>;
                  if (e.type==="thinking") return <div key={i} className="fin pulse" style={{ ...S.R, fontSize:".8rem", color:"#2a2a3a", fontStyle:"italic" }}>{e.text}</div>;
                  if (e.type==="briefing") return (
                    <div key={i} className="fin" style={{ background:"#080e18", border:"1px solid #1a2a3a", borderRadius:"6px", padding:"1rem", marginBottom:".5rem" }}>
                      <div style={{ ...S.C, fontSize:".5rem", color:"#4488FF", letterSpacing:".15em", marginBottom:".4rem" }}>📡 LIVE BRIEFING</div>
                      <div style={{ ...S.R, fontSize:".85rem", color:"#6a8faf", whiteSpace:"pre-wrap" }}>{e.text}</div>
                    </div>
                  );
                  if (e.type==="pred") {
                    const a=COUNCIL[e.id];
                    return (
                      <div key={i} className="fin" style={{ borderLeft:"3px solid "+a.color, paddingLeft:"1rem", marginBottom:"1rem" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:".5rem", marginBottom:".2rem" }}>
                          <span style={{ fontSize:".95rem" }}>{a.emoji}</span>
                          <span style={{ ...S.C, fontSize:".58rem", color:a.color }}>{a.name}</span>
                          {a.isCustom && <span style={{ ...S.C, fontSize:".46rem", background:a.color+"25", color:a.color, padding:"1px 6px", borderRadius:"3px" }}>YOUR ADVISOR</span>}
                          <span style={{ fontSize:".58rem", background:"#111", borderRadius:"3px", padding:"1px 6px", color:"#555", marginLeft:"auto" }}>{e.confidence}%</span>
                        </div>
                        <div style={{ ...S.R, color:"#c0c0c0", marginBottom:".2rem" }}>"{e.prediction}"</div>
                        <div style={{ display:"inline-flex", gap:".4rem", alignItems:"center", background:"#0f0f14", border:"1px solid "+(e.bet?.startsWith("NO")?"#FF444430":"#00C89630"), borderRadius:"3px", padding:"2px 8px", marginBottom:".2rem" }}>
                          <span style={{ ...S.C, fontSize:".48rem", color:"#555" }}>BET:</span>
                          <span style={{ ...S.C, fontSize:".58rem", color:e.bet?.startsWith("NO")?"#FF4444":"#00C896" }}>{e.bet}</span>
                        </div>
                        <div style={{ ...S.R, fontSize:".84rem", color:"#666", fontStyle:"italic" }}>{e.reasoning}</div>
                      </div>
                    );
                  }

                  if (e.type==="vote") {
                    const from=COUNCIL[e.from], to=COUNCIL[e.to];
                    return (
                      <div key={i} className="fin" style={{ display:"flex", gap:".75rem", padding:".4rem 0", borderBottom:"1px solid #0d0d12" }}>
                        <span style={{ fontSize:".85rem", flexShrink:0 }}>{from.emoji}</span>
                        <div>
                          <div style={{ ...S.R, fontSize:".88rem", color:"#666" }}>
                            <span style={{ color:from.color }}>{from.name}</span> votes for <span style={{ color:to.color }}>{to.emoji} {to.name}</span>
                          </div>
                          <div style={{ ...S.R, fontSize:".84rem", color:"#444", fontStyle:"italic" }}>"{e.reason}"</div>
                        </div>
                      </div>
                    );
                  }
                  if (e.type==="winner") {
                    const a=COUNCIL[e.id];
                    return (
                      <div key={i} className="fin" style={{ textAlign:"center", padding:"1.5rem 0 .5rem", borderTop:"1px solid #161620", marginTop:"1rem" }}>
                        <div style={{ fontSize:"2.5rem", marginBottom:".4rem" }}>{a.emoji}</div>
                        <div style={{ ...S.C, color:"#D4AF37", fontSize:".68rem", letterSpacing:".2em" }}>ORACLE VERDICT: {a.name.toUpperCase()}</div>
                        <div style={{ ...S.R, color:"#555", marginTop:".15rem" }}>{e.votes} of 6 votes</div>
                        {e.isCustom && <div style={{ ...S.C, fontSize:".58rem", color:"#D4AF37", marginTop:".5rem" }}>🎉 +2 POINTS — Your advisor won the vote!</div>}
                      </div>
                    );
                  }
                  return null;
                })}
                <div ref={logEndRef} />
              </div>
            )}

            {/* PREDICTIONS GRID */}
            {cTab==="predictions" && preds.length>0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:"1rem" }}>
                {preds.map(p => {
                  const a=COUNCIL[p.id]; const vc=winner?.tally?.[p.id]||0; const isW=winner?.id===p.id;
                  return (
                    <div key={p.id} className="fin" style={{ border:"1px solid "+(isW?a.color:"#161620"), borderRadius:"8px", padding:"1rem", background:isW?a.bg:"#0a0a0f", position:"relative" }}>
                      {isW && <div style={{ ...S.C, position:"absolute", top:"-9px", right:"10px", background:"#D4AF37", color:"#000", fontSize:".46rem", padding:"2px 8px", borderRadius:"20px", letterSpacing:".1em" }}>ORACLE PICK</div>}
                      {a.isCustom && <div style={{ ...S.C, position:"absolute", top:"-9px", left:"10px", background:a.color, color:"#000", fontSize:".46rem", padding:"2px 8px", borderRadius:"20px" }}>YOUR ADVISOR</div>}
                      <div style={{ display:"flex", alignItems:"center", gap:".5rem", marginBottom:".5rem" }}>
                        <span style={{ fontSize:"1.1rem" }}>{a.emoji}</span>
                        <div><div style={{ ...S.C, fontSize:".58rem", color:a.color }}>{a.name}</div><div style={{ fontSize:".52rem", color:"#444" }}>{a.shortTrait}</div></div>
                        {winner && <div style={{ ...S.C, marginLeft:"auto", fontSize:".65rem", color:vc>0?"#D4AF37":"#222" }}>{vc}v</div>}
                      </div>
                      <div style={{ ...S.R, color:"#bbb", marginBottom:".35rem" }}>"{p.prediction}"</div>
                      <div style={{ background:"#0f0f14", borderRadius:"3px", padding:".25rem .5rem", marginBottom:".35rem" }}>
                        <span style={{ ...S.C, fontSize:".48rem", color:"#555" }}>BET: </span>
                        <span style={{ ...S.C, fontSize:".58rem", color:p.bet?.startsWith("NO")?"#FF4444":"#00C896" }}>{p.bet}</span>
                      </div>
                      <div style={{ ...S.R, fontSize:".82rem", color:"#666", fontStyle:"italic" }}>{p.reasoning}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:".5rem", marginTop:".5rem" }}>
                        <div style={{ flex:1, height:"3px", background:"#111", borderRadius:"2px", overflow:"hidden" }}><div style={{ width:p.confidence+"%", height:"100%", background:a.color, transition:"width 1s" }} /></div>
                        <span style={{ ...S.C, fontSize:".52rem", color:"#444" }}>{p.confidence}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* RESULT */}
            {cTab==="result" && winner && (
              <div className="fin">
                <div className="gold-glow" style={{ border:"2px solid #D4AF37", borderRadius:"12px", padding:"2rem", background:"linear-gradient(135deg,#0d0b05,#07070a)", textAlign:"center", marginBottom:"1.5rem" }}>
                  <div style={{ ...S.C, fontSize:".56rem", letterSpacing:".3em", color:"#D4AF37", marginBottom:".85rem" }}>ORACLE VERDICT</div>
                  <div style={{ fontSize:"3rem", marginBottom:".4rem" }}>{winner.advisor.emoji}</div>
                  <div style={{ ...S.C, fontSize:"1.2rem", color:winner.advisor.color, marginBottom:".3rem" }}>{winner.advisor.name}</div>
                  {winner.advisor.isCustom && <div style={{ ...S.C, fontSize:".54rem", color:"#D4AF37", marginBottom:".75rem", letterSpacing:".15em" }}>🎉 YOUR ADVISOR WON — +2 POINTS</div>}
                  <div style={{ ...S.R, fontSize:"1.05rem", color:"#e0e0e0", fontStyle:"italic", maxWidth:"560px", margin:"0 auto 1rem" }}>"{winner.prediction}"</div>
                  <div style={{ display:"inline-block", background:"#0f0f14", border:"2px solid "+(winner.bet?.startsWith("NO")?"#FF4444":"#00C896"), borderRadius:"8px", padding:".65rem 2.5rem", marginBottom:"1.25rem" }}>
                    <div style={{ ...S.C, fontSize:".46rem", color:"#888", letterSpacing:".15em" }}>KALSHI BET</div>
                    <div style={{ ...S.C, fontSize:"1.1rem", color:winner.bet?.startsWith("NO")?"#FF4444":"#00C896" }}>{winner.bet}</div>
                  </div>
                  <div style={{ display:"flex", gap:"1rem", justifyContent:"center", flexWrap:"wrap" }}>
                    <Btn gold onClick={saveBet}>SAVE BET</Btn>
                    <Btn onClick={() => { resetCouncil(); setQuestion(""); }}>NEW QUESTION</Btn>
                    <Btn onClick={() => setTab(MAIN_TABS.SCOUT)}>🎯 SCOUT MORE</Btn>
                  </div>
                </div>
                <div style={{ background:"#0a0a0f", border:"1px solid #161620", borderRadius:"8px", padding:"1.25rem" }}>
                  <div style={{ ...S.C, fontSize:".56rem", color:"#444", letterSpacing:".2em", marginBottom:".85rem" }}>VOTE BREAKDOWN</div>
                  {COUNCIL.map(a => { const vc=winner.tally?.[a.id]||0; return (
                    <div key={a.id} style={{ display:"flex", alignItems:"center", gap:".75rem", marginBottom:".5rem" }}>
                      <span style={{ fontSize:".85rem", width:"1.3rem", textAlign:"center" }}>{a.emoji}</span>
                      <span style={{ ...S.C, fontSize:".56rem", color:a.color, width:"115px", flexShrink:0 }}>{a.name}</span>
                      <div style={{ flex:1, height:"4px", background:"#111", borderRadius:"2px", overflow:"hidden" }}><div style={{ width:Math.round(vc/6*100)+"%", height:"100%", background:a.color, transition:"width 1s" }} /></div>
                      <span style={{ ...S.C, fontSize:".58rem", color:vc>0?"#D4AF37":"#222", width:"42px", textAlign:"right" }}>{vc}v</span>
                    </div>
                  ); })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ HISTORY ══════════════════ */}
        {tab===MAIN_TABS.HISTORY && (
          <div>
            {history.length===0 ? (
              <div style={{ textAlign:"center", padding:"4rem 2rem", border:"1px dashed #1a1a25", borderRadius:"10px" }}>
                <div style={{ fontSize:"2.5rem", opacity:.15, marginBottom:"1rem" }}>📋</div>
                <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".2em", marginBottom:".5rem" }}>NO SAVED BETS</div>
                <div style={{ ...S.R, color:"#444", fontStyle:"italic" }}>Run the council and save your first prediction.</div>
              </div>
            ) : (
              <>
                <div style={{ display:"flex", gap:"1rem", marginBottom:"1.5rem", flexWrap:"wrap" }}>
                  {[["WINS",history.filter(b=>b.outcome==="WIN").length,"#00C896"],["LOSSES",history.filter(b=>b.outcome==="LOSS").length,"#FF4444"],["PENDING",history.filter(b=>!b.outcome).length,"#555"],["POINTS",points,"#D4AF37"]].map(([l,v,c]) => (
                    <div key={l} style={{ flex:1, minWidth:"70px", background:"#0a0a0f", border:"1px solid #161620", borderRadius:"8px", padding:".85rem", textAlign:"center" }}>
                      <div style={{ ...S.C, fontSize:"1.3rem", color:c }}>{v}</div>
                      <div style={{ ...S.C, fontSize:".48rem", color:"#444", letterSpacing:".15em", marginTop:".15rem" }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ ...S.R, fontSize:".82rem", color:"#333", marginBottom:"1rem", fontStyle:"italic" }}>
                  ⚠️ Outcomes are self-reported. Click PENDING to cycle WIN → LOSS → PENDING. Points update automatically for custom advisor wins.
                </div>
                {history.map((b,i) => (
                  <div key={i} className="fin" style={{ border:"1px solid #161620", borderRadius:"8px", padding:"1rem", marginBottom:".65rem", background:"#0a0a0f" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:".5rem" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:".5rem", flexWrap:"wrap" }}>
                        <span style={{ fontSize:".95rem" }}>{b.emoji}</span>
                        <span style={{ ...S.C, fontSize:".56rem", color:"#D4AF37" }}>{b.winner}</span>
                        {b.isCustomWin && <span style={{ ...S.C, fontSize:".46rem", background:"#D4AF3720", color:"#D4AF37", padding:"1px 6px", borderRadius:"3px" }}>YOUR ADVISOR</span>}
                        <span style={{ ...S.C, fontSize:".5rem", color:"#333" }}>{b.date}</span>
                      </div>
                      <button onClick={() => resolveOutcome(i, b.outcome===null?"WIN":b.outcome==="WIN"?"LOSS":null)}
                        style={{ background:"transparent", border:"1px solid "+(b.outcome==="WIN"?"#00C896":b.outcome==="LOSS"?"#FF4444":"#222"), color:b.outcome==="WIN"?"#00C896":b.outcome==="LOSS"?"#FF4444":"#444", padding:"2px 10px", borderRadius:"4px", fontFamily:"'Cinzel',serif", fontSize:".52rem", cursor:"pointer" }}>
                        {b.outcome||"PENDING"}
                      </button>
                    </div>
                    <div style={{ ...S.R, fontSize:".83rem", color:"#444", fontStyle:"italic", marginBottom:".2rem" }}>{b.question.slice(0,120)}{b.question.length>120?"...":""}</div>
                    <div style={{ ...S.R, color:"#999" }}>"{b.prediction}"</div>
                    <div style={{ ...S.C, fontSize:".58rem", color:b.bet?.startsWith("NO")?"#FF4444":"#00C896", marginTop:".35rem" }}>{b.bet}</div>
                    {b.isCustomWin && <div style={{ ...S.C, fontSize:".5rem", color:"#555", marginTop:".15rem" }}>Points: {b.outcome==="WIN"?"+5 (WIN)":b.outcome==="LOSS"?"+1 (LOSS)":"+2 (pending)"}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ══════════════════ ROSTER ══════════════════ */}
        {tab===MAIN_TABS.ROSTER && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem", flexWrap:"wrap", gap:"1rem" }}>
              <div>
                <div style={{ ...S.C, fontSize:".9rem", color:"#D4AF37", letterSpacing:".08em", marginBottom:".25rem" }}>ADVISOR ROSTER</div>
                <div style={{ ...S.R, color:"#555", fontSize:".88rem" }}>Build custom advisors. When yours wins council votes and bets, you earn points.</div>
              </div>
              <Btn gold onClick={() => openBuilder()}>+ CREATE ADVISOR</Btn>
            </div>

            <div style={{ background:"#0a0a0f", border:"1px solid #1e1e28", borderRadius:"8px", padding:"1rem 1.25rem", marginBottom:"1.5rem" }}>
              <div style={{ ...S.C, fontSize:".56rem", color:"#D4AF37", letterSpacing:".15em", marginBottom:".7rem" }}>HOW POINTS WORK</div>
              <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
                {[["🗳️ Win the vote","+2","Advisor wins the council vote"],["✅ Correct bet","+5","Vote winner + outcome = WIN"],["❌ Wrong bet","+1","Vote winner + outcome = LOSS"]].map(([icon,pts,desc]) => (
                  <div key={icon} style={{ flex:1, minWidth:"130px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:".4rem", marginBottom:".2rem" }}>
                      <span style={{ ...S.C, fontSize:".68rem", color:"#D4AF37" }}>{icon} {pts} pts</span>
                    </div>
                    <div style={{ ...S.R, fontSize:".8rem", color:"#555" }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {showBuilder && (
              <div className="fin" style={{ background:"#0a0a0f", border:"1px solid #D4AF3740", borderRadius:"12px", padding:"1.5rem", marginBottom:"1.5rem" }}>
                <div style={{ ...S.C, fontSize:".6rem", color:"#D4AF37", letterSpacing:".2em", marginBottom:"1.25rem" }}>{editingId?"EDIT ADVISOR":"CREATE ADVISOR"}</div>
                <div style={{ marginBottom:"1rem" }}>
                  <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".4rem" }}>NAME</div>
                  <input type="text" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="The Oracle, The Shark, The Quant..." maxLength={30} />
                </div>
                <div style={{ marginBottom:"1rem" }}>
                  <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".4rem" }}>EMOJI</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:".3rem" }}>
                    {ADVISOR_EMOJIS.map(em => (
                      <button key={em} onClick={() => setDraftEmoji(em)} style={{ fontSize:"1.1rem", background:draftEmoji===em?"#2a2a3a":"transparent", border:"1px solid "+(draftEmoji===em?"#D4AF37":"transparent"), borderRadius:"4px", padding:"2px 5px", cursor:"pointer" }}>{em}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom:"1rem" }}>
                  <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".4rem" }}>COLOR</div>
                  <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap" }}>
                    {ADVISOR_COLORS.map(c => (
                      <button key={c} onClick={() => setDraftColor(c)} style={{ width:"24px", height:"24px", borderRadius:"50%", background:c, border:draftColor===c?"2.5px solid #fff":"2px solid transparent", cursor:"pointer" }} />
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom:"1rem" }}>
                  <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".4rem" }}>REASONING STYLE <span style={{ color:"#333" }}>(your advisor's system prompt — be specific)</span></div>
                  <textarea rows={5} value={draftTrait} onChange={e => setDraftTrait(e.target.value)} placeholder={"e.g. \"You are a ruthless hedge fund manager who only bets on macro trends. You study central bank signals, bond yields, and currency flows. You always cite specific data and express extreme conviction. You see every prediction as a trade with a risk/reward ratio.\"\n\nThe more specific, the better."} />
                </div>
                <div style={{ marginBottom:"1.25rem" }}>
                  <div style={{ ...S.C, fontSize:".52rem", color:"#555", letterSpacing:".12em", marginBottom:".4rem" }}>SHORT LABEL <span style={{ color:"#333" }}>(shown under emoji)</span></div>
                  <input type="text" value={draftShort} onChange={e => setDraftShort(e.target.value)} placeholder="e.g. Macro trader, Quant analyst..." maxLength={24} />
                </div>
                {draftName && (
                  <div style={{ background:"#0f0f14", border:"1px solid "+draftColor+"40", borderRadius:"8px", padding:".75rem 1rem", marginBottom:"1rem", display:"flex", alignItems:"center", gap:".75rem" }}>
                    <span style={{ fontSize:"1.5rem" }}>{draftEmoji}</span>
                    <div>
                      <div style={{ ...S.C, fontSize:".7rem", color:draftColor }}>{draftName}</div>
                      <div style={{ ...S.R, fontSize:".8rem", color:"#555" }}>{draftShort||"Custom advisor"}</div>
                    </div>
                    <div style={{ ...S.C, fontSize:".48rem", color:"#333", marginLeft:"auto" }}>PREVIEW</div>
                  </div>
                )}
                <div style={{ display:"flex", gap:".75rem" }}>
                  <Btn gold onClick={saveAdvisor} disabled={!draftName.trim()||!draftTrait.trim()}>SAVE ADVISOR</Btn>
                  <Btn onClick={() => setShowBuilder(false)}>CANCEL</Btn>
                </div>
              </div>
            )}

            {customAdvisors.length===0 && !showBuilder && (
              <div style={{ textAlign:"center", padding:"3rem 2rem", border:"1px dashed #1a1a25", borderRadius:"10px", marginBottom:"1.5rem" }}>
                <div style={{ fontSize:"2rem", opacity:.15, marginBottom:".75rem" }}>🧬</div>
                <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".2em", marginBottom:".5rem" }}>NO CUSTOM ADVISORS</div>
                <div style={{ ...S.R, color:"#444", fontStyle:"italic" }}>Create your first advisor. When they win votes and bets, you earn points toward the leaderboard.</div>
              </div>
            )}

            {customAdvisors.length>0 && (
              <div style={{ marginBottom:"2rem" }}>
                <div style={{ ...S.C, fontSize:".56rem", color:"#555", letterSpacing:".15em", marginBottom:".75rem" }}>YOUR ADVISORS</div>
                <div style={{ display:"flex", flexDirection:"column", gap:".75rem" }}>
                  {customAdvisors.map(a => {
                    const isActive=activeCustomId===a.id;
                    return (
                      <div key={a.id} className="fin" style={{ border:"1px solid "+(isActive?a.color+"60":"#1e1e28"), borderRadius:"10px", padding:"1.1rem", background:isActive?a.color+"08":"#0a0a0f" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"1rem" }}>
                          <div style={{ display:"flex", alignItems:"flex-start", gap:".85rem", flex:1 }}>
                            <div style={{ fontSize:"2rem", flexShrink:0 }}>{a.emoji}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:".5rem", marginBottom:".2rem", flexWrap:"wrap" }}>
                                <span style={{ ...S.C, fontSize:".74rem", color:a.color }}>{a.name}</span>
                                {isActive && <span style={{ ...S.C, fontSize:".48rem", background:a.color+"20", color:a.color, padding:"1px 8px", borderRadius:"20px" }}>ACTIVE IN COUNCIL</span>}
                              </div>
                              <div style={{ ...S.R, fontSize:".8rem", color:"#555", marginBottom:".35rem" }}>{a.shortTrait}</div>
                              <div style={{ ...S.R, fontSize:".8rem", color:"#444", fontStyle:"italic" }}>"{a.trait.slice(0,140)}{a.trait.length>140?"...":""}"</div>
                            </div>
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", gap:".4rem", flexShrink:0 }}>
                            <button onClick={() => setActiveCustomId(isActive?null:a.id)}
                              style={{ ...S.C, fontSize:".54rem", letterSpacing:".06em", padding:".35rem .85rem", borderRadius:"4px", background:isActive?a.color:"transparent", color:isActive?"#000":a.color, border:"1px solid "+a.color, cursor:"pointer" }}>
                              {isActive?"✓ ACTIVE":"ACTIVATE"}
                            </button>
                            <Btn small onClick={() => openBuilder(a)}>EDIT</Btn>
                            <Btn small danger onClick={() => deleteAdvisor(a.id)}>DELETE</Btn>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div style={{ ...S.C, fontSize:".56rem", color:"#555", letterSpacing:".15em", marginBottom:".75rem" }}>DEFAULT COUNCIL</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))", gap:".6rem" }}>
                {DEFAULT_COUNCIL.map((a,i) => {
                  const replaced=i===6&&activeAdv;
                  return (
                    <div key={a.id} style={{ border:"1px solid #1e1e28", borderRadius:"8px", padding:".75rem", background:"#0a0a0f", opacity:replaced?.35:1, position:"relative" }}>
                      {replaced && <div style={{ ...S.C, position:"absolute", top:"-8px", left:"50%", transform:"translateX(-50%)", background:"#FF4444", color:"#fff", fontSize:".43rem", padding:"1px 8px", borderRadius:"10px", whiteSpace:"nowrap" }}>REPLACED</div>}
                      <div style={{ display:"flex", alignItems:"center", gap:".5rem", marginBottom:".2rem" }}>
                        <span style={{ fontSize:".95rem" }}>{a.emoji}</span>
                        <span style={{ ...S.C, fontSize:".58rem", color:a.color }}>{a.name}</span>
                      </div>
                      <div style={{ ...S.R, fontSize:".76rem", color:"#444" }}>{a.shortTrait}</div>
                    </div>
                  );
                })}
              </div>
              {activeAdv && <div style={{ ...S.R, fontSize:".8rem", color:"#444", marginTop:".75rem", fontStyle:"italic" }}>Your active advisor replaces The Futurist (slot 7) in the council.</div>}
            </div>
          </div>
        )}

        {/* ══════════════════ LEADERBOARD ══════════════════ */}

        {tab===MAIN_TABS.ARBITRAGE && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem", flexWrap:"wrap", gap:"1rem" }}>
              <div>
                <div style={{ ...S.C, fontSize:".9rem", color:"#D4AF37", letterSpacing:".08em", marginBottom:".25rem" }}>ARBITRAGE SCANNER</div>
                <div style={{ ...S.R, color:"#555", fontSize:".85rem" }}>Cross-platform mispricings between Kalshi and Polymarket.</div>
              </div>
              <Btn gold onClick={runArbitrage} disabled={arbBusy}>{arbBusy ? "SCANNING..." : "⚡ SCAN NOW"}</Btn>
            </div>
            {arbBusy && <div style={{ textAlign:"center", padding:"3rem" }}><div style={{ ...S.C, fontSize:".62rem", letterSpacing:".2em", color:"#D4AF37" }} className="pulse">SCANNING KALSHI & POLYMARKET...</div></div>}
            {arbErr && <div style={{ background:"#1a0000", border:"1px solid #FF444433", borderRadius:"6px", padding:"1rem", marginBottom:"1rem" }}><div style={{ ...S.R, color:"#FF4444", marginBottom:".5rem" }}>⚠️ {arbErr}</div><Btn small danger onClick={runArbitrage}>TRY AGAIN</Btn></div>}
            {arbData.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
                {arbData.map((a, i) => {
                  const confColor = a.confidence==="High"?"#FF4444":a.confidence==="Medium"?"#D4AF37":"#555";
                  const isCross = a.type==="Cross-Platform";
                  return (
                    <div key={i} className="fin card" style={{ padding:"1.25rem", border:"1px solid "+confColor+"30" }}>
                      <div style={{ display:"flex", gap:".5rem", marginBottom:".5rem", flexWrap:"wrap", alignItems:"center" }}>
                        <span style={{ ...S.C, fontSize:".52rem", background:isCross?"#CC44FF20":"#4488FF20", color:isCross?"#CC44FF":"#4488FF", border:"1px solid "+(isCross?"#CC44FF40":"#4488FF40"), borderRadius:"3px", padding:"1px 8px" }}>{a.type}</span>
                        <span style={{ ...S.C, fontSize:".52rem", background:confColor+"20", color:confColor, border:"1px solid "+confColor+"40", borderRadius:"3px", padding:"1px 8px" }}>{a.confidence} Confidence</span>
                        {a.discrepancy && <span style={{ ...S.C, fontSize:".58rem", color:"#D4AF37", fontWeight:"bold" }}>⚡ {a.discrepancy}</span>}
                      </div>
                      <div style={{ ...S.C, fontSize:".78rem", color:"#e0e0e0", marginBottom:".35rem" }}>{a.title}</div>
                      <div style={{ ...S.R, fontSize:".85rem", color:"#888", fontStyle:"italic", marginBottom:".75rem" }}>{a.opportunity}</div>
                      <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
                        {a.kalshiOdds && a.kalshiOdds!=="N/A" && (
                          <div style={{ background:"#0f0f14", border:"1px solid #1e1e28", borderRadius:"6px", padding:".6rem 1rem", flex:1, minWidth:"130px" }}>
                            <div style={{ ...S.C, fontSize:".48rem", color:"#444", letterSpacing:".15em", marginBottom:".2rem" }}>KALSHI</div>
                            <div style={{ ...S.C, fontSize:".9rem", color:"#00C896" }}>{a.kalshiOdds}</div>
                            {a.kalshiTitle && <div style={{ ...S.R, fontSize:".75rem", color:"#555", marginTop:".15rem" }}>{a.kalshiTitle}</div>}
                          </div>
                        )}
                        {a.polyOdds && a.polyOdds!=="N/A" && (
                          <div style={{ background:"#0f0f14", border:"1px solid #1e1e28", borderRadius:"6px", padding:".6rem 1rem", flex:1, minWidth:"130px" }}>
                            <div style={{ ...S.C, fontSize:".48rem", color:"#444", letterSpacing:".15em", marginBottom:".2rem" }}>POLYMARKET</div>
                            <div style={{ ...S.C, fontSize:".9rem", color:"#4488FF" }}>{a.polyOdds}</div>
                            {a.polyTitle && <div style={{ ...S.R, fontSize:".75rem", color:"#555", marginTop:".15rem" }}>{a.polyTitle}</div>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!arbBusy && !arbData.length && !arbErr && (
              <div style={{ textAlign:"center", padding:"4rem 2rem", border:"1px dashed #1a1a25", borderRadius:"10px" }}>
                <div style={{ fontSize:"2.5rem", opacity:.15, marginBottom:"1rem" }}>⚡</div>
                <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".2em", marginBottom:".5rem" }}>NO SCAN RUN YET</div>
                <div style={{ ...S.R, color:"#444", fontStyle:"italic" }}>Click "Scan Now" to find arbitrage opportunities.</div>
              </div>
            )}
          </div>
        )}
        {tab===MAIN_TABS.LEADERBOARD && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem", flexWrap:"wrap", gap:"1rem" }}>
              <div>
                <div style={{ ...S.C, fontSize:".9rem", color:"#D4AF37", letterSpacing:".08em", marginBottom:".25rem" }}>LEADERBOARD</div>
                <div style={{ ...S.R, color:"#555", fontSize:".88rem" }}>Top Oracle advisors ranked by score.</div>
              </div>
              <Btn small onClick={loadLeaderboard}>{lbLoading?"LOADING...":"↻ REFRESH"}</Btn>
            </div>

            <div style={{ background:"#0a0a0f", border:"1px solid #1a2a1a", borderRadius:"8px", padding:"1rem 1.25rem", marginBottom:"1.5rem" }}>
              <div style={{ ...S.C, fontSize:".52rem", color:"#4a7a4a", letterSpacing:".12em", marginBottom:".4rem" }}>ℹ️ NOTE ON LEADERBOARD</div>
              <div style={{ ...S.R, fontSize:".82rem", color:"#4a6a4a" }}>
                In this build the leaderboard is stored in your browser's local storage, so it's only visible to you. To make it truly public, the app needs a backend (Supabase, Firebase, etc.). See the deployment guide.
              </div>
            </div>

            <div style={{ background:"#0a0a0f", border:"1px solid #1e1e28", borderRadius:"8px", padding:"1.1rem 1.25rem", marginBottom:"1.5rem" }}>
              <div style={{ ...S.C, fontSize:".56rem", color:"#D4AF37", letterSpacing:".15em", marginBottom:".65rem" }}>YOUR IDENTITY</div>
              {username ? (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"1rem", flexWrap:"wrap" }}>
                  <div>
                    <div style={{ ...S.C, fontSize:".8rem", color:"#e0e0e0" }}>{username}</div>
                    <div style={{ ...S.R, fontSize:".82rem", color:"#555" }}>Score: <span style={{ color:"#D4AF37" }}>{points} pts</span> · {history.filter(h=>h.outcome==="WIN").length}W / {history.filter(h=>h.outcome==="LOSS").length}L</div>
                  </div>
                  <Btn small onClick={() => { setUsername(""); setDraftUser(""); }}>CHANGE NAME</Btn>
                </div>
              ) : (
                <div>
                  <div style={{ ...S.R, fontSize:".84rem", color:"#555", marginBottom:".6rem", fontStyle:"italic" }}>Set a username to track your score.</div>
                  <div style={{ display:"flex", gap:".75rem", alignItems:"center" }}>
                    <input type="text" value={draftUser} onChange={e => setDraftUser(e.target.value)} placeholder="Enter username..." maxLength={24} onKeyDown={e => { if (e.key==="Enter"&&draftUser.trim()) { setUsername(draftUser.trim()); pushLeaderboard(points); }}} />
                    <Btn gold onClick={() => { if (draftUser.trim()) { setUsername(draftUser.trim()); pushLeaderboard(points); }}}>SET</Btn>
                  </div>
                </div>
              )}
            </div>

            {lbLoading ? (
              <div style={{ textAlign:"center", padding:"2rem" }}>
                <div style={{ ...S.C, fontSize:".6rem", letterSpacing:".2em", color:"#4488FF" }} className="pulse">LOADING...</div>
              </div>
            ) : lbData.length===0 ? (
              <div style={{ textAlign:"center", padding:"4rem 2rem", border:"1px dashed #1a1a25", borderRadius:"10px" }}>
                <div style={{ fontSize:"2.5rem", opacity:.15, marginBottom:"1rem" }}>🏆</div>
                <div style={{ ...S.C, fontSize:".58rem", color:"#444", letterSpacing:".2em", marginBottom:".5rem" }}>NO ENTRIES YET</div>
                <div style={{ ...S.R, color:"#444", fontStyle:"italic" }}>Create an advisor, win votes, resolve bets.</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
                {lbData.map((e,i) => {
                  const isMe=e.username===username;
                  const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
                  return (
                    <div key={i} className="fin" style={{ border:"1px solid "+(isMe?"#D4AF3760":"#1e1e28"), borderRadius:"8px", padding:".85rem 1rem", background:isMe?"#0d0b05":"#0a0a0f", display:"flex", alignItems:"center", gap:"1rem" }}>
                      <div style={{ ...S.C, fontSize:".9rem", color:i<3?"#D4AF37":"#333", width:"2rem", textAlign:"center" }}>{medal||(i+1)}</div>
                      <div style={{ fontSize:"1.2rem" }}>{e.advisorEmoji}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:".5rem" }}>
                          <span style={{ ...S.C, fontSize:".68rem", color:isMe?"#D4AF37":"#e0e0e0" }}>{e.username}</span>
                          {isMe && <span style={{ ...S.C, fontSize:".46rem", background:"#D4AF3720", color:"#D4AF37", padding:"1px 6px", borderRadius:"3px" }}>YOU</span>}
                        </div>
                        <div style={{ ...S.R, fontSize:".78rem", color:"#555" }}>{e.advisorName} · {e.wins||0}W / {Math.max(0,(e.total||0)-(e.wins||0))}L</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ ...S.C, fontSize:"1.1rem", color:"#D4AF37" }}>{e.points}</div>
                        <div style={{ ...S.C, fontSize:".46rem", color:"#444", letterSpacing:".1em" }}>PTS</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
