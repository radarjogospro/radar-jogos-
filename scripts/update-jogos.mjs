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
});
