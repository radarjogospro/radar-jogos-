import fs from "fs";

const KEY = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL || "";
if (!KEY) {
  console.error("Missing API key. Set API_FOOTBALL_KEY in repo secrets.");
  process.exit(1);
}

const OUT = "jogos.json";

// Quantos jogos no JSON final
const MAX_GAMES = 2500;

// Janela anti “jogo de ontem” (em horas)
const KEEP_PAST_HOURS = 3;    // <= reduz bem os atrasados
const KEEP_FUTURE_HOURS = 24; // jogos das próximas 24h

// (Opcional) tentar “probabilidades” via predictions
// ATENÇÃO: isso pode consumir limite da API.
// Se não tiver endpoint no seu plano, vai falhar e ficará null.
const ENABLE_PREDICTIONS = true;
const MAX_PREDICTIONS = 80; // só para os primeiros N jogos mais relevantes

const BASE = "https://v3.football.api-sports.io";

function nowMs() { return Date.now(); }

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toFixed2(n) {
  return (Number.isFinite(n) ? n : null);
}

function impliedOddsFromPercents(pHome, pDraw, pAway) {
  // p em [0..1]
  const eps = 1e-9;
  const oh = pHome > eps ? 1 / pHome : null;
  const od = pDraw > eps ? 1 / pDraw : null;
  const oa = pAway > eps ? 1 / pAway : null;
  return {
    o1: oh ? Math.round(oh * 100) / 100 : null,
    ox: od ? Math.round(od * 100) / 100 : null,
    o2: oa ? Math.round(oa * 100) / 100 : null,
  };
}

function parsePercentString(s) {
  // "45%" => 0.45
  if (!s) return null;
  const m = String(s).trim().replace("%", "");
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

async function apiGet(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "x-apisports-key": KEY,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path} :: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function isLiveFromStatusShort(short) {
  // API-Football status.short comuns:
  // NS, 1H, HT, 2H, ET, BT, P, SUSP, INT, LIVE, FT, AET, PEN, PST, CANC, ABD...
  const liveSet = new Set(["1H", "HT", "2H", "ET", "P", "LIVE", "BT", "SUSP", "INT"]);
  return liveSet.has(short);
}

function normalizeFixture(fx) {
  const fixture = fx.fixture || {};
  const teams = fx.teams || {};
  const league = fx.league || {};
  const goals = fx.goals || {};
  const score = fx.score || {};
  const status = fixture.status || {};

  // ✅ O mais importante: usar timestamp (epoch) do API-Football
  // fixture.timestamp vem em segundos (UTC)
  const tsSec = safeNum(fixture.timestamp);
  const kickoffTs = tsSec ? tsSec * 1000 : null;

  const short = status.short || null;
  const elapsed = safeNum(status.elapsed);

  const isLive = short ? isLiveFromStatusShort(short) : false;

  return {
    id: safeNum(fixture.id),
    home: teams.home?.name || "",
    away: teams.away?.name || "",
    league: league.name || "",
    country: league.country || "",
    // Mantém strings também (só pra exibição/compatibilidade)
    date: (fixture.date ? String(fixture.date).slice(0, 10) : null), // YYYY-MM-DD
    time: (fixture.date ? String(fixture.date).slice(11, 16) : null), // HH:MM
    kickoffTs,

    status: short || "",
    isLive,
    elapsed: isLive ? (elapsed ?? null) : null,

    scoreHome: safeNum(goals.home),
    scoreAway: safeNum(goals.away),

    // placares detalhados se quiser usar depois
    htHome: safeNum(score?.halftime?.home),
    htAway: safeNum(score?.halftime?.away),

    // probabilidades / odds (vamos tentar preencher depois)
    p1: null,
    px: null,
    p2: null,
    o1: null,
    ox: null,
    o2: null,
  };
}

function withinWindow(game, now) {
  if (!game.kickoffTs) return false;

  const pastMs = KEEP_PAST_HOURS * 60 * 60 * 1000;
  const futureMs = KEEP_FUTURE_HOURS * 60 * 60 * 1000;

  // Mantém:
  // - ao vivo sempre
  // - jogos que começaram até X horas atrás
  // - jogos que vão começar até Y horas na frente
  if (game.isLive) return true;

  const dt = game.kickoffTs - now;

  // dt < 0: já começou
  if (dt < 0) {
    return (Math.abs(dt) <= pastMs);
  }

  // dt > 0: futuro
  return dt <= futureMs;
}

async function enrichPredictions(games) {
  if (!ENABLE_PREDICTIONS) return;

  // Ordena por “mais relevante” (ao vivo primeiro, depois mais perto)
  const now = nowMs();
  const sorted = [...games].sort((a, b) => {
    const la = a.isLive ? 0 : 1;
    const lb = b.isLive ? 0 : 1;
    if (la !== lb) return la - lb;
    const da = Math.abs((a.kickoffTs ?? 0) - now);
    const db = Math.abs((b.kickoffTs ?? 0) - now);
    return da - db;
  });

  const pick = sorted.slice(0, MAX_PREDICTIONS);

  // Faz requests sequenciais (menos chance de estourar limite)
  for (const g of pick) {
    if (!g.id) continue;
    try {
      const data = await apiGet(`/predictions?fixture=${g.id}`);
      const resp = data?.response?.[0];
      if (!resp) continue;

      // A API costuma trazer percentuais no formato:
      // resp.predictions.percent.home / draw / away  (strings "45%")
      const perc = resp.predictions?.percent || {};
      const p1 = parsePercentString(perc.home);
      const px = parsePercentString(perc.draw);
      const p2 = parsePercentString(perc.away);

      // normaliza pra somar 1
      const sum = (p1 ?? 0) + (px ?? 0) + (p2 ?? 0);
      if (sum > 0) {
        const np1 = p1 != null ? p1 / sum : null;
        const npx = px != null ? px / sum : null;
        const np2 = p2 != null ? p2 / sum : null;

        g.p1 = toFixed2(np1);
        g.px = toFixed2(npx);
        g.p2 = toFixed2(np2);

        const odds = impliedOddsFromPercents(np1 ?? 0, npx ?? 0, np2 ?? 0);
        g.o1 = odds.o1;
        g.ox = odds.ox;
        g.o2 = odds.o2;
      }
    } catch (e) {
      // Se não tiver endpoint no plano, vai cair aqui e seguimos sem travar o workflow
      // console.warn("predictions failed for", g.id, String(e.message || e));
    }
  }
}

async function main() {
  const now = nowMs();

  // Pega fixtures do “hoje” e também do “ontem/amanhã” pra cobrir viradas e fusos
  // (mas a FILTRAGEM final é pela janela KEEP_* acima)
  const d0 = new Date(now);
  const dYesterday = new Date(now - 24 * 60 * 60 * 1000);
  const dTomorrow = new Date(now + 24 * 60 * 60 * 1000);

  const yyyyMMdd = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  };

  const dates = [yyyyMMdd(dYesterday), yyyyMMdd(d0), yyyyMMdd(dTomorrow)];

  let all = [];
  for (const date of dates) {
    const data = await apiGet(`/fixtures?date=${date}`);
    const arr = Array.isArray(data?.response) ? data.response : [];
    all.push(...arr);
  }

  // Normaliza + remove duplicados
  const map = new Map();
  for (const fx of all) {
    const g = normalizeFixture(fx);
    if (!g.id) continue;
    map.set(g.id, g);
  }

  let games = Array.from(map.values());

  // Filtra pela janela (anti “ontem”)
  games = games.filter((g) => withinWindow(g, now));

  // Ordena por kickoff (ao vivo primeiro)
  games.sort((a, b) => {
    const la = a.isLive ? 0 : 1;
    const lb = b.isLive ? 0 : 1;
    if (la !== lb) return la - lb;
    return (a.kickoffTs ?? 0) - (b.kickoffTs ?? 0);
  });

  // Limita volume
  if (games.length > MAX_GAMES) games = games.slice(0, MAX_GAMES);

  // (Opcional) tenta preencher probabilidades/odds com predictions
  await enrichPredictions(games);

  const payload = {
    updatedAt: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    cacheBust: String(Date.now()),
    source: "API-Football",
    games,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Saved ${games.length} games to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
