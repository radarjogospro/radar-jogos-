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
const KEEP_PAST_HOURS = 6;     // mantém jogos finalizados até 6h atrás
const KEEP_FUTURE_HOURS = 24;  // mantém jogos até 24h na frente

// (Opcional) tentar “probabilidades” via predictions
const ENABLE_PREDICTIONS = true;
const MAX_PREDICTIONS = 60; // abaixa um pouco pra não estourar limite

const BASE = "https://v3.football.api-sports.io";
const TZ = "America/Sao_Paulo";

function nowMs() { return Date.now(); }

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parsePercentString(s) {
  // "45%" => 0.45
  if (!s) return null;
  const m = String(s).trim().replace("%", "");
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

function impliedOddsFromPercents(pHome, pDraw, pAway) {
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

function tzYmd(ms) {
  // YYYY-MM-DD no fuso do Brasil (SP)
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const da = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${da}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiGet(path, tries = 3) {
  const url = `${BASE}${path}`;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      headers: { "x-apisports-key": KEY },
    });

    if (res.ok) return res.json();

    // retry em 429/5xx
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      const wait = 800 * Math.pow(2, i); // 800ms, 1600ms, 3200ms
      await sleep(wait);
      continue;
    }

    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path} :: ${txt.slice(0, 200)}`);
  }

  throw new Error(`HTTP failed after retries on ${path}`);
}

function isLiveFromStatusShort(short) {
  // "INT" NÃO é ao vivo.
  // Ao vivo real (inclui intervalo/HT):
  const live = new Set(["1H", "2H", "ET", "HT", "P", "LIVE"]);
  return live.has(short);
}

function isFinishedShort(short) {
  // finalizados
  const fin = new Set(["FT", "AET", "PEN"]);
  return fin.has(short);
}

function normalizeFixture(fx, now) {
  const fixture = fx.fixture || {};
  const teams = fx.teams || {};
  const league = fx.league || {};
  const goals = fx.goals || {};
  const score = fx.score || {};
  const status = fixture.status || {};

  const tsSec = safeNum(fixture.timestamp); // seconds UTC
  const kickoffTs = tsSec ? tsSec * 1000 : null;

  const short = status.short || "";
  const isLive = isLiveFromStatusShort(short);

  // elapsed: usa o da API; se vier null e for live, calcula por diferença
  let elapsed = safeNum(status.elapsed);
  if (isLive && (elapsed == null) && kickoffTs) {
    const mins = Math.floor((now - kickoffTs) / 60000);
    elapsed = Math.max(0, Math.min(130, mins));
  }
  if (!isLive) elapsed = null;

  return {
    id: safeNum(fixture.id),
    home: teams.home?.name || "",
    away: teams.away?.name || "",
    league: league.name || "",
    country: league.country || "",

    date: fixture.date ? String(fixture.date).slice(0, 10) : null,
    time: fixture.date ? String(fixture.date).slice(11, 16) : null,
    kickoffTs,

    status: short,
    isLive,
    elapsed,

    scoreHome: safeNum(goals.home),
    scoreAway: safeNum(goals.away),

    htHome: safeNum(score?.halftime?.home),
    htAway: safeNum(score?.halftime?.away),

    p1: null, px: null, p2: null,
    o1: null, ox: null, o2: null,
  };
}

function withinWindow(game, now) {
  if (!game.kickoffTs) return false;

  const pastMs = KEEP_PAST_HOURS * 3600 * 1000;
  const futureMs = KEEP_FUTURE_HOURS * 3600 * 1000;

  if (game.isLive) return true;

  const dt = game.kickoffTs - now;

  // Já começou
  if (dt < 0) {
    // se finalizou, segura só por X horas
    if (isFinishedShort(game.status)) {
      return Math.abs(dt) <= pastMs;
    }
    // se está "NS" / "PST" etc, deixa o filtro seguir normal (não segura)
    return Math.abs(dt) <= pastMs;
  }

  // Futuro
  return dt <= futureMs;
}

async function enrichPredictions(games) {
  if (!ENABLE_PREDICTIONS) return;

  const now = nowMs();
  const sorted = [...games].sort((a, b) => {
    const la = a.isLive ? 0 : 1;
    const lb = b.isLive ? 0 : 1;
    if (la !== lb) return la - lb;
    return Math.abs((a.kickoffTs ?? 0) - now) - Math.abs((b.kickoffTs ?? 0) - now);
  });

  const pick = sorted.slice(0, MAX_PREDICTIONS);

  for (const g of pick) {
    if (!g.id) continue;
    try {
      const data = await apiGet(`/predictions?fixture=${g.id}`);
      const resp = data?.response?.[0];
      if (!resp) continue;

      const perc = resp.predictions?.percent || {};
      const p1 = parsePercentString(perc.home);
      const px = parsePercentString(perc.draw);
      const p2 = parsePercentString(perc.away);

      const sum = (p1 ?? 0) + (px ?? 0) + (p2 ?? 0);
      if (sum > 0) {
        const np1 = p1 != null ? p1 / sum : null;
        const npx = px != null ? px / sum : null;
        const np2 = p2 != null ? p2 / sum : null;

        g.p1 = np1;
        g.px = npx;
        g.p2 = np2;

        const odds = impliedOddsFromPercents(np1 ?? 0, npx ?? 0, np2 ?? 0);
        g.o1 = odds.o1;
        g.ox = odds.ox;
        g.o2 = odds.o2;
      }
    } catch (e) {
      // deixa quieto pra não quebrar workflow
    }
  }
}

function loadPreviousIfAny() {
  try {
    if (!fs.existsSync(OUT)) return null;
    const raw = fs.readFileSync(OUT, "utf-8");
    const json = JSON.parse(raw);
    if (Array.isArray(json?.games) && json.games.length > 0) return json;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const now = nowMs();

  // Datas para janela (em dias) no fuso do Brasil
  // busca de -1 dia até +1 dia pra cobrir virada/fuso
  const ymd0 = tzYmd(now);
  const ymdPrev = tzYmd(now - 24 * 3600 * 1000);
  const ymdNext = tzYmd(now + 24 * 3600 * 1000);

  // 1) Ao vivo (mais confiável)
  let liveArr = [];
  try {
    const live = await apiGet(`/fixtures?live=all&timezone=${encodeURIComponent(TZ)}`);
    liveArr = Array.isArray(live?.response) ? live.response : [];
  } catch (e) {
    liveArr = [];
  }

  // 2) Janela de datas (from/to)
  const win = await apiGet(`/fixtures?from=${ymdPrev}&to=${ymdNext}&timezone=${encodeURIComponent(TZ)}`);
  const winArr = Array.isArray(win?.response) ? win.response : [];

  // Merge + dedupe
  const map = new Map();
  for (const fx of [...winArr, ...liveArr]) {
    const g = normalizeFixture(fx, now);
    if (!g.id) continue;
    map.set(g.id, g);
  }

  let games = Array.from(map.values());

  // Filtra janela
  games = games.filter((g) => withinWindow(g, now));

  // Ordena (ao vivo primeiro, depois por kickoff)
  games.sort((a, b) => {
    const la = a.isLive ? 0 : 1;
    const lb = b.isLive ? 0 : 1;
    if (la !== lb) return la - lb;
    return (a.kickoffTs ?? 0) - (b.kickoffTs ?? 0);
  });

  if (games.length > MAX_GAMES) games = games.slice(0, MAX_GAMES);

  // Se vier vazio, NÃO destrói o app: mantém o último JSON válido
  if (games.length === 0) {
    const prev = loadPreviousIfAny();
    if (prev) {
      prev.updatedAt = new Date().toLocaleString("pt-BR", { timeZone: TZ });
      prev.cacheBust = String(Date.now());
      fs.writeFileSync(OUT, JSON.stringify(prev, null, 2), "utf-8");
      console.log(`No games from API. Kept previous ${prev.games.length} games in ${OUT}`);
      return;
    }
  }

  await enrichPredictions(games);

  const payload = {
    updatedAt: new Date().toLocaleString("pt-BR", { timeZone: TZ }),
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
