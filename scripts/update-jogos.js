/**
 * update-jogos.js v2.2
 * - Gera jogos.json (BRT) com HOJE+AMANHÃ + AO VIVO
 * - Normaliza status e aplica "auto-finish" para evitar live travado em 90'
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
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return { date, time };
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
    console.warn(`⚠️ API ${res.status} attempt ${attempt}: ${txt.slice(0, 140)}`);
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

  // Só aplica se a API estiver dizendo que está "ao vivo"
  if (!LIVE_SET.has(status)) return false;

  const now = Date.now();
  const ageMin = (now - kickoffMs) / 60000;

  // Regras conservadoras:
  // - Se bateu 90' e já passou tempo suficiente do kickoff -> encerra
  // - Se elapsed sumiu mas o kickoff já é bem antigo -> encerra
  const el = typeof elapsed === "number" ? elapsed : null;

  // Sem prorrogação: após ~2h20 do kickoff e 90' já é praticamente garantido que acabou
  if (el !== null && el >= 90 && ageMin >= 140) return true;

  // Se for ET, pode ir mais longe:
  if (status === "ET" && ageMin >= 220) return true;

  // Se ficou "2H/HT" por tempo demais mesmo sem elapsed:
  if (el === null && ageMin >= 180) return true;

  return false;
}

function mapFixtureToGame(fx) {
  const fixture = fx.fixture || {};
  const teams = fx.teams || {};
  const league = fx.league || {};
  const goals = fx.goals || {};

  const id = fixture.id;
  const tsSec = fixture.timestamp; // segundos
  const kickoffMs = tsSec ? tsSec * 1000 : null;

  const statusShort = normalizeStatusShort(fixture.status?.short);
  let status = statusShort;

  const elapsed = fixture.status?.elapsed ?? null;

  // Placar
  const homeGoals = typeof goals.home === "number" ? goals.home : null;
  const awayGoals = typeof goals.away === "number" ? goals.away : null;

  // Live real (antes do auto-finish)
  let isLive =
    LIVE_SET.has(status) ||
    String(fixture.status?.long || "").toLowerCase().includes("live");

  // Se status já é finished, garante:
  if (FINISHED.has(status)) isLive = false;

  // Auto-finish (principal correção do “travado em 90”)
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

    // Preferir a versão que tem status mais “final” e/ou placar
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
