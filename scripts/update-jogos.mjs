import fs from "fs";

const KEY = process.env.API_FOOTBALL_KEY || "";
const OUT = "jogos.json";

// Ajuste se você quiser menos/mais jogos no arquivo
const MAX_GAMES = 2500;

// Janela anti “jogo de ontem” (em horas)
const KEEP_PAST_HOURS = 6;   // mantém jogos de até 6h atrás (ex: acabou agora pouco)
const KEEP_FUTURE_HOURS = 18; // mantém jogos de até 18h à frente

function pad(n){ return String(n).padStart(2,"0"); }
function ymd(d){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function nowMs(){ return Date.now(); }

function asMsFromFixture(fx){
  // API-Football geralmente manda date ISO em fixture.date
  const iso = fx?.fixture?.date;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function statusShort(fx){
  return String(fx?.fixture?.status?.short || "").toUpperCase();
}

function isLiveStatus(short){
  // status live típicos do API-Football:
  // 1H, 2H, HT, ET, P, LIVE
  return ["1H","2H","HT","ET","P","LIVE"].includes(short);
}

function isFinishedStatus(short){
  return ["FT","AET","PEN"].includes(short);
}

function clampElapsed(short, elapsed){
  if(isFinishedStatus(short)) return 90;
  const n = Number(elapsed);
  if(!Number.isFinite(n)) return null;
  // cap de segurança pra não virar 154'
  return Math.max(0, Math.min(n, 130));
}

async function apiFetch(url){
  const res = await fetch(url, {
    headers: {
      "x-apisports-key": KEY,
      "accept": "application/json",
    }
  });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getFixturesByDate(dateStr){
  // Endpoint API-Football:
  // https://v3.football.api-sports.io/fixtures?date=YYYY-MM-DD
  const url = `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(dateStr)}`;
  const json = await apiFetch(url);
  return Array.isArray(json?.response) ? json.response : [];
}

function normalizeFixture(fx){
  const home = fx?.teams?.home?.name || "Casa";
  const away = fx?.teams?.away?.name || "Fora";
  const league = fx?.league?.name || "Liga";
  const country = fx?.league?.country || "World";

  const ms = asMsFromFixture(fx);
  const kickoffTs = ms ? Math.floor(ms/1000) : null;

  const short = statusShort(fx);
  const elapsedRaw = fx?.fixture?.status?.elapsed;
  const elapsed = clampElapsed(short, elapsedRaw);

  const isLive = isLiveStatus(short);
  const status = isFinishedStatus(short) ? "FT" : (isLive ? "LIVE" : (short || "NS"));

  const scoreHome = fx?.goals?.home ?? null;
  const scoreAway = fx?.goals?.away ?? null;

  // ⚠️ Odds: API-Football geralmente precisa outro endpoint (/odds) e pode não vir no FREE.
  // Aqui deixamos null (o app mostra —).
  const odds = { home: null, draw: null, away: null };

  return {
    id: fx?.fixture?.id ?? `${league}-${home}-${away}-${kickoffTs ?? ""}`,
    home,
    away,
    league,
    country,
    date: kickoffTs ? new Date(kickoffTs*1000).toISOString().slice(0,10) : "",
    time: kickoffTs ? new Date(kickoffTs*1000).toISOString().slice(11,16) : "",
    kickoffTs: kickoffTs ? kickoffTs*1000 : null, // mantém compatível com seu JSON anterior (ms)
    status,
    isLive,
    elapsed: elapsed ?? null,
    scoreHome,
    scoreAway,
    odds
  };
}

function filterWindow(g){
  // Remove jogos muito antigos ou muito longes no futuro
  if(!g.kickoffTs) return true;

  const t = Number(g.kickoffTs);
  if(!Number.isFinite(t)) return true;

  const diffH = (t - nowMs()) / (3600*1000);

  // mantém se:
  // - ao vivo (sempre)
  // - ou dentro da janela (passado recente / futuro próximo)
  if(g.isLive) return true;

  return diffH >= -KEEP_PAST_HOURS && diffH <= KEEP_FUTURE_HOURS;
}

function deDupeById(list){
  const map = new Map();
  for(const g of list){
    map.set(String(g.id), g);
  }
  return Array.from(map.values());
}

async function main(){
  if(!KEY){
    // Se não tiver KEY, mantém o arquivo antigo sem quebrar tudo
    console.log("API_FOOTBALL_KEY vazio. Mantendo jogos.json como está.");
    process.exit(0);
  }

  const d0 = new Date();
  const d1 = new Date(Date.now() - 24*3600*1000);
  const d2 = new Date(Date.now() + 24*3600*1000);

  const dates = [ymd(d1), ymd(d0), ymd(d2)];

  let fixtures = [];
  for(const dt of dates){
    try{
      const fx = await getFixturesByDate(dt);
      fixtures = fixtures.concat(fx);
    }catch(e){
      console.log("Erro buscando", dt, e.message);
    }
  }

  const games = fixtures.map(normalizeFixture);
  const clean = deDupeById(games)
    .filter(filterWindow)
    // segurança: não deixar “FT” marcado como live
    .map(g => {
      if(g.status === "FT") g.isLive = false;
      if(g.elapsed != null && g.status === "FT") g.elapsed = 90;
      return g;
    })
    .slice(0, MAX_GAMES);

  const out = {
    updatedAt: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " BRT",
    source: "API-Football",
    games: clean
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("OK ->", OUT, "games:", clean.length);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});/**
 * update-jogos.js v2.3
 * - Gera jogos.json (BRT) com HOJE+AMANHÃ + AO VIVO
 * - Normaliza status e aplica "auto-finish" mais agressivo (pra não travar em 90')
 *
 * Requer Secret: API_FOOTBALL_KEY
 */

const fs = require("fs");

const TZ = "America/Sao_Paulo";
const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY || "";

if (!API_KEY) {
  console.error("❌ Missing API_FOOTBALL_KEY. Configure em Settings > Secrets > Actions.");
  process.exit(1);
}

function brtNowParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date };
}

function addDaysYYYYMMDD(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatBRTFromTimestampSec(tsSec) {
  const dt = new Date(tsSec * 1000);
  const fmtDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);

  const fmtTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);

  return { date: fmtDate, time: fmtTime };
}

async function apiGet(path, qs = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, String(v));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "x-apisports-key": API_KEY },
    });

    if (res.ok) return res.json();

    const txt = await res.text().catch(() => "");
    console.warn(`⚠️ API ${res.status} attempt ${attempt}: ${txt.slice(0, 160)}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 900 * attempt));
  }

  throw new Error("API request failed after retries.");
}

function normalizeStatusShort(short) {
  if (!short) return "UNK";
  return String(short).toUpperCase();
}

const FINISHED = new Set(["FT", "AET", "PEN"]);
const LIVE_SET = new Set(["1H", "2H", "HT", "ET", "BT", "P"]);
const CANCELLED = new Set(["PST", "CANC", "SUSP", "ABD", "AWD", "WO", "TBD"]);

function shouldAutoFinish({ status, elapsed, kickoffMs }) {
  if (!kickoffMs) return false;
  if (FINISHED.has(status)) return false;
  if (CANCELLED.has(status)) return false;
  if (!LIVE_SET.has(status)) return false;

  const now = Date.now();
  const ageMin = (now - kickoffMs) / 60000;
  const el = typeof elapsed === "number" ? elapsed : null;

  // ✅ v2.3: mais agressivo (resolve o seu caso ~136min)
  // - 90' + passou 120 min do kickoff => encerra
  if (el !== null && el >= 90 && ageMin >= 120) return true;

  // Prorrogação: deixa mais folga
  if (status === "ET" && ageMin >= 210) return true;

  // Se não tem elapsed mas já é muito antigo
  if (el === null && ageMin >= 165) return true;

  return false;
}

function mapFixtureToGame(fx) {
  const fixture = fx.fixture || {};
  const teams = fx.teams || {};
  const league = fx.league || {};
  const goals = fx.goals || {};

  const id = fixture.id;
  const tsSec = fixture.timestamp;
  const kickoffMs = tsSec ? tsSec * 1000 : null;

  let status = normalizeStatusShort(fixture.status?.short);
  const elapsed = fixture.status?.elapsed ?? null;

  const homeGoals = typeof goals.home === "number" ? goals.home : null;
  const awayGoals = typeof goals.away === "number" ? goals.away : null;

  let isLive =
    LIVE_SET.has(status) ||
    String(fixture.status?.long || "").toLowerCase().includes("live");

  if (FINISHED.has(status)) isLive = false;

  if (shouldAutoFinish({ status, elapsed, kickoffMs })) {
    status = "FT";
    isLive = false;
  }

  const brt = tsSec ? formatBRTFromTimestampSec(tsSec) : { date: "", time: "" };

  return {
    id,
    home: teams.home?.name || "Home",
    away: teams.away?.name || "Away",
    league: league.name || "",
    country: league.country || "",
    date: brt.date || "",
    time: brt.time || "",
    kickoffTs: kickoffMs,
    status,
    isLive: !!isLive,
    elapsed,
    scoreHome: homeGoals,
    scoreAway: awayGoals,
  };
}

function uniqById(games) {
  const map = new Map();
  for (const g of games) {
    if (!g?.id) continue;

    const prev = map.get(g.id);
    if (!prev) {
      map.set(g.id, g);
      continue;
    }

    const prevFinished = FINISHED.has(prev.status);
    const newFinished = FINISHED.has(g.status);

    const prevScore = prev.scoreHome !== null || prev.scoreAway !== null;
    const newScore = g.scoreHome !== null || g.scoreAway !== null;

    if (newFinished && !prevFinished) map.set(g.id, g);
    else if (newScore && !prevScore) map.set(g.id, g);
    else if (g.isLive && !prev.isLive) map.set(g.id, g);
    else map.set(g.id, { ...prev, ...g });
  }
  return [...map.values()];
}

async function main() {
  const { date: todayBRT } = brtNowParts();
  const tomorrowBRT = addDaysYYYYMMDD(todayBRT, 1);

  const [todayData, tomorrowData] = await Promise.all([
    apiGet("/fixtures", { date: todayBRT }),
    apiGet("/fixtures", { date: tomorrowBRT }),
  ]);

  let liveData = { response: [] };
  try {
    liveData = await apiGet("/fixtures", { live: "all" });
  } catch (e) {
    console.warn("⚠️ live=all falhou (pode acontecer no FREE). Seguindo sem live extra.");
  }

  const raw = [
    ...(todayData?.response || []),
    ...(tomorrowData?.response || []),
    ...(liveData?.response || []),
  ];

  const mapped = raw.map(mapFixtureToGame);
  const games = uniqById(mapped)
    .filter((g) => g.kickoffTs)
    .sort((a, b) => (a.kickoffTs || 0) - (b.kickoffTs || 0));

  const updatedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

  const out = {
    updatedAt: `${updatedAt} BRT`,
    source: "API-Football",
    games,
  };

  fs.writeFileSync("jogos.json", JSON.stringify(out, null, 2), "utf-8");
  console.log(`✅ jogos.json atualizado: ${games.length} jogos.`);
}

main().catch((e) => {
  console.error("❌ Falha ao gerar jogos.json:", e?.message || e);
  process.exit(1);
});
