import fs from "fs";

// Atualiza jogos.json usando API-Football (api-sports) quando houver chave.
// Se não houver chave (ou der erro), cai no DEMO (mesmo formato do app).

const OUT = "jogos.json";
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_HOST = "v3.football.api-sports.io";
const BASE = `https://${API_HOST}`;

function tsSeconds(ms){ return Math.floor(ms/1000); }

async function fetchJson(url){
  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY,
      "x-apisports-host": API_HOST
    }
  });
  if(!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${txt.slice(0,300)}`);
  }
  return res.json();
}

function mapFixtureToGame(fx){
  const fixture = fx.fixture || {};
  const league  = fx.league || {};
  const teams   = fx.teams || {};
  const goals   = fx.goals || {};
  const score   = fx.score || {};
  const st      = (fx.fixture?.status?.short || "").toUpperCase();
  const elapsed = fx.fixture?.status?.elapsed;
  const startISO = fixture.date; // API já respeita timezone=America/Sao_Paulo na string
  const startMs = startISO ? Date.parse(startISO) : null;

  // status no formato do app (mantém short quando possível)
  // LIVE / NS / FT / HT / 1H / 2H / AET / PEN etc.
  const status = st || "NS";

  // minuto: usa elapsed (minuto real)
  const minute = (typeof elapsed === "number") ? elapsed : null;

  // placar: usa goals (futebol) ou score fulltime quando terminar
  const scoreHome = (typeof goals.home === "number") ? goals.home : null;
  const scoreAway = (typeof goals.away === "number") ? goals.away : null;

  const id = fx.fixture?.id ? `fb-${fx.fixture.id}` : `fb-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    sport: "football",
    league: league.name || "",
    country: league.country || "",
    home: teams.home?.name || "",
    away: teams.away?.name || "",
    startTs: startMs ? tsSeconds(startMs) : null,
    status,
    minute,
    scoreHome,
    scoreAway,
    odds: { home: null, draw: null, away: null }
  };
}

async function generateReal(){
  // Puxa ao vivo + jogos de hoje e amanhã (horário do Brasil)
  const tz = "America/Sao_Paulo";
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const tomorrow = new Date(today.getTime() + 24*60*60*1000);
  const yyyy2 = tomorrow.getFullYear();
  const mm2 = String(tomorrow.getMonth()+1).padStart(2,"0");
  const dd2 = String(tomorrow.getDate()).padStart(2,"0");
  const dateStr2 = `${yyyy2}-${mm2}-${dd2}`;

  const liveUrl = `${BASE}/fixtures?live=all&timezone=${encodeURIComponent(tz)}`;
  const todayUrl = `${BASE}/fixtures?date=${dateStr}&timezone=${encodeURIComponent(tz)}`;
  const tomorrowUrl = `${BASE}/fixtures?date=${dateStr2}&timezone=${encodeURIComponent(tz)}`;

  const [live, day1, day2] = await Promise.all([
    fetchJson(liveUrl).catch(()=> ({response:[]})),
    fetchJson(todayUrl).catch(()=> ({response:[]})),
    fetchJson(tomorrowUrl).catch(()=> ({response:[]}))
  ]);

  const seen = new Set();
  const all = [];
  for (const src of [live.response||[], day1.response||[], day2.response||[]]){
    for (const fx of src){
      const fid = fx?.fixture?.id;
      if (fid && seen.has(fid)) continue;
      if (fid) seen.add(fid);
      all.push(mapFixtureToGame(fx));
    }
  }

  // ordena por horário
  all.sort((a,b)=> (a.startTs||0) - (b.startTs||0));

  return all;
}

/* ================= DEMO (fallback) ================= */

const nowMs = Date.now();
const rnd = (seed) => {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
};
const daySeed = Number(new Date().toISOString().slice(0,10).replaceAll("-","")) + Math.floor(nowMs/60000);
const r = rnd(daySeed);
const pick = (arr) => arr[Math.floor(r() * arr.length)];
const randint = (a,b) => a + Math.floor(r() * (b - a + 1));
const footballLeagues = [
  ["Premier League", "England"],
  ["La Liga", "Spain"],
  ["Serie A", "Italy"],
  ["Bundesliga", "Germany"],
  ["Ligue 1", "France"],
  ["Brasileirão", "Brazil"],
  ["MLS", "USA"],
  ["Liga MX", "Mexico"],
  ["J-League", "Japan"],
  ["K League", "South Korea"],
  ["Saudi Pro League", "Saudi Arabia"],
  ["Libertadores", "South America"],
  ["Champions League", "Europe"],
];
const footballTeams = [
  "Arsenal","Chelsea","Liverpool","Man City","Man United","Tottenham",
  "Barcelona","Real Madrid","Atletico Madrid","Sevilla",
  "Juventus","Milan","Inter","Napoli","Roma",
  "Bayern","Dortmund","Leverkusen","RB Leipzig",
  "PSG","Marseille","Lyon",
  "Flamengo","Palmeiras","Corinthians","São Paulo","Grêmio","Internacional",
  "Inter Miami","LA Galaxy","NYCFC","Seattle Sounders",
  "Al Hilal","Al Nassr","Al Ittihad",
  "Kawasaki Frontale","Yokohama F. Marinos","Urawa Reds",
];
function makeGameId(prefix, i) { return `${prefix}-${String(i).padStart(4,"0")}`; }
function footballGame(i){
  const [league, country] = pick(footballLeagues);
  const home = pick(footballTeams);
  let away = pick(footballTeams);
  if (away === home) away = pick(footballTeams);
  const startMs = nowMs + randint(-90*60*1000, 12*60*60*1000);
  const started = startMs <= nowMs;
  let status = "NS", minute = null, scoreHome = null, scoreAway = null;
  if (started) {
    const isLive = r() < 0.7;
    if (isLive) {
      status = "LIVE"; minute = randint(1, 90);
      scoreHome = randint(0, 4); scoreAway = randint(0, 4);
    } else {
      status = "FT"; minute = 90;
      scoreHome = randint(0, 5); scoreAway = randint(0, 5);
    }
  }
  return {
    id: makeGameId("fb", i),
    sport: "football",
    league, country, home, away,
    startTs: tsSeconds(startMs),
    status, minute, scoreHome, scoreAway,
    odds: { home: null, draw: null, away: null }
  };
}
function generateDemo(){
  const games = [];
  for (let i=1;i<=220;i++) games.push(footballGame(i));
  games.sort((a,b)=> (a.startTs||0)-(b.startTs||0));
  return games;
}

/* ================= MAIN ================= */

async function main(){
  let games = [];
  let source = "DEMO";
  try{
    if(!API_KEY) throw new Error("Sem API_FOOTBALL_KEY");
    games = await generateReal();
    source = "REAL";
    if(!games.length) throw new Error("API retornou 0 jogos");
  }catch(err){
    console.log("[WARN] Caindo no DEMO:", err?.message || err);
    games = generateDemo();
    source = "DEMO";
  }

  const payload = {
    updatedAt: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    cacheBust: String(Date.now()),
    source,
    games
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`jogos.json gerado: ${games.length} (${source})`);
}

main();
