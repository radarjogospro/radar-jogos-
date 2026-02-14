/**
 * update-jogos.js (API-Football)
 * Gera jogos.json no fuso America/Sao_Paulo (BRT) e com timestamp para filtros por janela (1h/2h/...).
 *
 * Requisitos:
 * - Secret/ENV: API_FOOTBALL_KEY
 *
 * Observação:
 * - No plano FREE, é normal a API limitar endpoints/retornos dependendo do seu plano.
 */

const fs = require("fs");

const API_KEY = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_TOKEN || "";
const TZ = "America/Sao_Paulo";
const BASE = "https://v3.football.api-sports.io";

function pad(n) {
  return String(n).padStart(2, "0");
}

// Data no fuso BRT usando Intl (sem libs)
function getDatePartsInTZ(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA -> YYYY-MM-DD
  const ymd = fmt.format(date);
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day, ymd };
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = pad(dt.getUTCMonth() + 1);
  const dd = pad(dt.getUTCDate());
  return `${yy}-${mm}-${dd}`;
}

async function apiFetch(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "x-apisports-key": API_KEY,
      accept: "application/json",
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Resposta não-JSON da API: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }

  // Alguns erros vêm com { errors: {...} }
  if (data?.errors && Object.keys(data.errors).length) {
    throw new Error(`API errors: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

function normalizeFixture(fx) {
  const fixture = fx.fixture || {};
  const league = fx.league || {};
  const teams = fx.teams || {};
  const goals = fx.goals || {};
  const score = fx.score || {};

  // API-Football costuma trazer timestamp em seconds
  const kickoffTs = fixture.timestamp ? fixture.timestamp * 1000 : null;

  // “date” vem em ISO (UTC). Mantemos também.
  const kickoffISO = fixture.date || null;

  // Status (FT, HT, NS, 1H, 2H etc)
  const statusShort = fixture.status?.short || "";
  const statusLong = fixture.status?.long || "";

  return {
    id: fixture.id || null,
    home: teams.home?.name || "Home",
    away: teams.away?.name || "Away",
    league: league.name || "",
    country: league.country || "",
    // Para filtro e exibição correta:
    kickoffTs,      // timestamp (ms)
    kickoffISO,     // iso original
    // Para exibir placar:
    goalsHome: Number.isFinite(goals.home) ? goals.home : null,
    goalsAway: Number.isFinite(goals.away) ? goals.away : null,
    status: statusShort || "",
    statusLong: statusLong || "",
    // extras úteis
    round: league.round || "",
    season: league.season || null,
  };
}

function isLiveStatus(short) {
  // API-Football: 1H, 2H, HT, ET, BT, P, LIVE etc. (varia)
  const liveSet = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE"]);
  return liveSet.has(short);
}

function isFinalStatus(short) {
  const finalSet = new Set(["FT", "AET", "PEN"]);
  return finalSet.has(short);
}

function toUpdatedAtBRT(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // "dd/mm/aaaa hh:mm"
  const str = fmt.format(now).replace(",", "");
  return `${str} BRT`;
}

async function main() {
  if (!API_KEY) {
    console.error("ERRO: faltou API_FOOTBALL_KEY (Secrets/ENV).");
    process.exit(1);
  }

  const now = new Date();
  const { ymd: todayBRT } = getDatePartsInTZ(now, TZ);
  const tomorrowBRT = addDays(todayBRT, 1);

  // 2 chamadas (HOJE + AMANHÃ) no fuso BRT
  // Importante: timezone=America/Sao_Paulo para a API já devolver horários ajustados
  const pathToday = `/fixtures?date=${todayBRT}&timezone=${encodeURIComponent(TZ)}`;
  const pathTomorrow = `/fixtures?date=${tomorrowBRT}&timezone=${encodeURIComponent(TZ)}`;

  const [d1, d2] = await Promise.all([apiFetch(pathToday), apiFetch(pathTomorrow)]);

  const list = []
    .concat(d1?.response || [])
    .concat(d2?.response || []);

  // Normaliza e ordena por kickoffTs
  let games = list.map(normalizeFixture).filter(g => g.kickoffTs);

  games.sort((a, b) => a.kickoffTs - b.kickoffTs);

  // Estatísticas rápidas pro seu header
  const nowTs = now.getTime();
  const next24hTs = nowTs + 24 * 60 * 60 * 1000;

  let countLive = 0;
  let countToday = 0;
  let countNext24h = 0;

  for (const g of games) {
    if (isLiveStatus(g.status)) countLive++;
    // “Hoje” baseado no kickoff estar entre 00:00-23:59 BRT (aprox)
    // Como estamos buscando só hoje+amanhã, consideramos “today” pelo kickoff >= agora-24h e < amanhã 00:00 BRT (simplificado)
    // Na UI você vai filtrar por timestamp mesmo, então aqui é só informativo.
    if (g.kickoffTs >= nowTs - 24 * 60 * 60 * 1000 && g.kickoffTs <= nowTs + 24 * 60 * 60 * 1000) countToday++;
    if (g.kickoffTs >= nowTs && g.kickoffTs <= next24hTs) countNext24h++;
  }

  const out = {
    updatedAt: toUpdatedAtBRT(now),
    source: "API-Football",
    timezone: TZ,
    meta: {
      todayBRT,
      tomorrowBRT,
      total: games.length,
      live: countLive,
      next24h: countNext24h,
      // “todayApprox” apenas informativo
      todayApprox: countToday,
    },
    games,
  };

  fs.writeFileSync("jogos.json", JSON.stringify(out, null, 2), "utf-8");
  console.log(`OK: jogos.json gerado. Total: ${games.length} | Live: ${countLive} | Próx 24h: ${countNext24h}`);
}

main().catch((err) => {
  console.error("ERRO:", err?.message || err);
  process.exit(1);
});
