/**
 * Gera jogos.json (BRT) com:
 * - fixtures de HOJE e AMANHÃ (BRT)
 * - jogos AO VIVO (live=all)
 * - kickoffTs (timestamp), placar quando ao vivo e status
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

  // en-CA -> YYYY-MM-DD
  const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return { date, time };
}

function addDaysYYYYMMDD(dateStr, days) {
  // cria data base em UTC "meio-dia" pra evitar bugs de DST
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

  // retry simples (rate/instabilidade)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        "x-apisports-key": API_KEY,
      },
    });

    if (res.ok) return res.json();

    const txt = await res.text().catch(() => "");
    console.warn(`⚠️ API ${res.status} attempt ${attempt}: ${txt.slice(0, 120)}`);

    if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
  }

  throw new Error("API request failed after retries.");
}

function normalizeStatusShort(short) {
  // API-Football costuma trazer: NS, 1H, HT, 2H, FT, AET, PEN, PST, CANC...
  if (!short) return "UNK";
  return String(short).toUpperCase();
}

function mapFixtureToGame(fx) {
  const fixture = fx.fixture || {};
  const teams = fx.teams || {};
  const league = fx.league || {};
  const goals = fx.goals || {};
  const score = fx.score || {};

  const id = fixture.id;
  const ts = fixture.timestamp; // segundos UTC
  const statusShort = fixture.status?.short;
  const status = normalizeStatusShort(statusShort);

  const isLive = ["1H", "2H", "HT", "ET", "BT", "P"].includes(status) || fx?.fixture?.status?.long?.toLowerCase?.().includes("live");

  const brt = ts ? formatBRTFromTimestampSec(ts) : { date: null, time: null };

  const homeName = teams.home?.name || "Home";
  const awayName = teams.away?.name || "Away";

  // Placar: em live geralmente goals.home/goals.away; em FT também
  const homeGoals = typeof goals.home === "number" ? goals.home : null;
  const awayGoals = typeof goals.away === "number" ? goals.away : null;

  // elapsed/minutos
  const elapsed = fixture.status?.elapsed ?? null;

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
    // se já existe, preferir o que tem live/placar
    const prev = map.get(g.id);
    if (!prev) map.set(g.id, g);
    else {
      const prevScore = prev.scoreHome !== null || prev.scoreAway !== null;
      const newScore = g.scoreHome !== null || g.scoreAway !== null;
      if (newScore && !prevScore) map.set(g.id, g);
      else if (g.isLive && !prev.isLive) map.set(g.id, g);
      else map.set(g.id, { ...prev, ...g });
    }
  }
  return [...map.values()];
}

async function main() {
  const { date: todayBRT } = brtNowParts();
  const tomorrowBRT = addDaysYYYYMMDD(todayBRT, 1);

  // 1) HOJE e AMANHÃ (BRT) — garante “próximas 1h/2h/...”
  const [todayData, tomorrowData] = await Promise.all([
    apiGet("/fixtures", { date: todayBRT }),
    apiGet("/fixtures", { date: tomorrowBRT }),
  ]);

  // 2) AO VIVO
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
    .filter((g) => g.kickoffTs) // remove sem timestamp
    .sort((a, b) => a.kickoffTs - b.kickoffTs);

  const updatedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const out = {
    updatedAt: `${updatedAt} BRT`,
    source: "API-Football",
    games,
  };

  fs.writeFileSync("jogos.json", JSON.stringify(out, null, 2), "utf-8");
  console.log(`✅ jogos.json atualizado: ${games.length} jogos (hoje+amanhã+live).`);
}

main().catch((e) => {
  console.error("❌ Falha ao gerar jogos.json:", e?.message || e);
  process.exit(1);
});
