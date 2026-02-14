/**
 * Gera jogos.json (BRT) com:
 * - fixtures de HOJE e AMANHÃ (BRT)
 * - jogos AO VIVO (live=all)
 * - kickoffTs (timestamp), placar quando ao vivo e status
 *
 * Requer Secret: API_FOOTBALL_KEY
 */

const fs = require("fs");
const path = require("path");

const TZ = "America/Sao_Paulo";
const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY || "";

// ✅ Ajuste de sanidade: depois de X minutos do kickoff, não pode continuar "ao vivo"
const LIVE_STALE_MINUTES = 140; // ~2h20

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

async function apiGet(pathname, qs = {}) {
  const url = new URL(API_BASE + pathname);
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, String(v));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "x-apisports-key": API_KEY },
    });

    if (res.ok) return res.json();

    const txt = await res.text().catch(() => "");
    console.warn(`⚠️ API ${res.status} attempt ${attempt}: ${txt.slice(0, 180)}`);

    if (attempt < 3) await new Promise((r) => setTimeout(r, 900 * attempt));
  }

  throw new Error("API request failed after retries.");
}

function normalizeStatusShort(short) {
  if (!short) return "UNK";
  return String(short).toUpperCase().trim();
}

function isFinishedStatus(status) {
  return ["FT", "AET", "PEN", "CANC", "ABD", "PST", "SUSP", "WO", "AWD"].includes(status);
}

// ✅ “sanidade”: se passou muito tempo do kickoff, derruba ao vivo
function isStaleLive(tsSec, elapsed) {
  if (!tsSec) return false;
  if (typeof elapsed !== "number" || elapsed < 80) return false;

  const kickoffMs = tsSec * 1000;
  const now = Date.now();
  const ageMin = (now - kickoffMs) / 60000;
  return ageMin >= LIVE_STALE_MINUTES;
}

function mapFixtureToGame(fx) {
  const fixture = fx.fixture || {};
  const teams = fx.teams || {};
  const league = fx.league || {};
  const goals = fx.goals || {};

  const id = fixture.id;
  const ts = fixture.timestamp; // segundos UTC

  const statusShort = fixture.status?.short;
  let status = normalizeStatusShort(statusShort);

  const longTxt = String(fixture.status?.long || "").toLowerCase();
  const elapsed = fixture.status?.elapsed ?? null;

  // live “normal”
  let isLive =
    ["1H", "2H", "HT", "ET", "BT", "P"].includes(status) ||
    longTxt.includes("live") ||
    longTxt.includes("in play") ||
    longTxt.includes("inplay");

  // ✅ se status é final, nunca ao vivo
  if (isFinishedStatus(status) || longTxt.includes("finished")) {
    isLive = false;
  }

  // ✅ se está “90’ preso” e já passou tempo demais, derruba ao vivo e marca como FT
  if (isLive && ts && isStaleLive(ts, elapsed)) {
    isLive = false;
    // se a API ainda não mandou FT, a gente “força” um status coerente
    status = "FT";
  }

  const brt = ts ? formatBRTFromTimestampSec(ts) : { date: null, time: null };

  const homeName = teams.home?.name || "Home";
  const awayName = teams.away?.name || "Away";

  const homeGoals = typeof goals.home === "number" ? goals.home : null;
  const awayGoals = typeof goals.away === "number" ? goals.away : null;

  return {
    id,
    home: homeName,
    away: awayName,
    league: league.name || "",
    country: league.country || "",
    date: brt.date || "",
    time: brt.time || "",
    kickoffTs: ts ? ts * 1000 : null, // ms
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

    const prevScore = prev.scoreHome !== null || prev.scoreAway !== null;
    const newScore = g.scoreHome !== null || g.scoreAway !== null;

    if (newScore && !prevScore) map.set(g.id, g);
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
    console.warn("⚠️ live=all falhou (ok no FREE às vezes). Seguindo sem live extra.");
  }

  const raw = [
    ...(todayData?.response || []),
    ...(tomorrowData?.response || []),
    ...(liveData?.response || []),
  ];

  const mapped = raw.map(mapFixtureToGame);

  const games = uniqById(mapped)
    .filter((g) => g.kickoffTs)
    .sort((a, b) => a.kickoffTs - b.kickoffTs);

  // ✅ updatedAt com segundos (pra você ver que está realmente atualizando)
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

  const outPath = path.join(process.cwd(), "jogos.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`✅ jogos.json atualizado: ${games.length} jogos (hoje+amanhã+live).`);
}

main().catch((e) => {
  console.error("❌ Falha ao gerar jogos.json:", e?.message || e);
  process.exit(1);
});
