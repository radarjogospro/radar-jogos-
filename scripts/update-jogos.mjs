import fs from "fs";

// Gera dados DEMO no formato do seu app (sem API)
// Roda no GitHub Actions e atualiza jogos.json sempre que quiser.

const OUT = "jogos.json";
const nowMs = Date.now();
const now = new Date(nowMs);

const rnd = (seed) => {
  // PRNG simples e determinístico por dia (pra não ficar “pulando” do nada)
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
};

const daySeed = Number(now.toISOString().slice(0,10).replaceAll("-","")) + Math.floor(nowMs/60000);
const r = rnd(daySeed);

const pick = (arr) => arr[Math.floor(r() * arr.length)];
const randint = (a,b) => a + Math.floor(r() * (b - a + 1));

const sports = [
  { key: "football", label: "Futebol" },
  { key: "tennis", label: "Tênis" },
  { key: "basketball", label: "Basquete" },
  { key: "volleyball", label: "Vôlei" },
];

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

const tennisTours = [
  ["ATP 250", "World"],
  ["ATP 500", "World"],
  ["Masters 1000", "World"],
  ["WTA 250", "World"],
  ["WTA 500", "World"],
  ["Grand Slam", "World"],
];

const tennisPlayers = [
  "Djokovic","Alcaraz","Sinner","Medvedev","Zverev","Rublev",
  "Swiatek","Sabalenka","Gauff","Rybakina","Pegula","Jabeur",
];

const basketballLeagues = [
  ["NBA","USA"],
  ["EuroLeague","Europe"],
  ["NBB","Brazil"],
  ["ACB","Spain"],
];

const basketballTeams = [
  "Lakers","Warriors","Celtics","Bulls","Heat","Nuggets",
  "Real Madrid","Barcelona","Olympiacos","Fenerbahçe",
  "Flamengo","Franca","Minas","Corinthians",
];

const volleyballLeagues = [
  ["Superliga","Brazil"],
  ["VNL","World"],
  ["CEV Champions League","Europe"],
];

const volleyballTeams = [
  "Sada Cruzeiro","Minas","SESI Bauru","Vôlei Renata",
  "Trentino","Perugia","Zaksa","Zenit Kazan",
];

function makeGameId(prefix, i) {
  return `${prefix}-${String(i).padStart(4,"0")}`;
}

function tsSecondsFromMs(ms){ return Math.floor(ms/1000); }

function footballGame(i){
  const [league, country] = pick(footballLeagues);
  const home = pick(footballTeams);
  let away = pick(footballTeams);
  if (away === home) away = pick(footballTeams);

  // janela: -90min até +12h
  const startMs = nowMs + randint(-90*60*1000, 12*60*60*1000);
  const started = startMs <= nowMs;

  let status = "NS";
  let minute = null;
  let scoreHome = null;
  let scoreAway = null;

  if (started) {
    // 70% fica LIVE, 30% vira FT
    const isLive = r() < 0.7;
    if (isLive) {
      status = "LIVE";
      minute = randint(1, 90);
      scoreHome = randint(0, 4);
      scoreAway = randint(0, 4);
    } else {
      status = "FT";
      minute = 90;
      scoreHome = randint(0, 5);
      scoreAway = randint(0, 5);
    }
  }

  const oddsHome = Number((1.5 + r()*2.2).toFixed(2));
  const oddsDraw = Number((2.6 + r()*1.8).toFixed(2));
  const oddsAway = Number((1.6 + r()*3.0).toFixed(2));

  return {
    id: makeGameId("fb", i),
    sport: "football",
    league,
    country,
    home,
    away,
    startTs: tsSecondsFromMs(startMs),
    status,
    minute,
    scoreHome,
    scoreAway,
    odds: { home: oddsHome, draw: oddsDraw, away: oddsAway }
  };
}

function tennisGame(i){
  const [league, country] = pick(tennisTours);
  const home = pick(tennisPlayers);
  let away = pick(tennisPlayers);
  if (away === home) away = pick(tennisPlayers);

  const startMs = nowMs + randint(-60*60*1000, 10*60*60*1000);
  const started = startMs <= nowMs;

  let status = started ? (r() < 0.75 ? "LIVE" : "FT") : "NS";
  let minute = started && status==="LIVE" ? randint(1, 180) : null;

  // Para simplificar, usamos scoreHome/scoreAway como “games/sets” genéricos
  const scoreHome = started ? randint(0, 2) : null;
  const scoreAway = started ? randint(0, 2) : null;

  return {
    id: makeGameId("tn", i),
    sport: "tennis",
    league,
    country,
    home,
    away,
    startTs: tsSecondsFromMs(startMs),
    status,
    minute,
    scoreHome,
    scoreAway,
    odds: { home: null, draw: null, away: null }
  };
}

function basketballGame(i){
  const [league, country] = pick(basketballLeagues);
  const home = pick(basketballTeams);
  let away = pick(basketballTeams);
  if (away === home) away = pick(basketballTeams);

  const startMs = nowMs + randint(-90*60*1000, 10*60*60*1000);
  const started = startMs <= nowMs;

  let status = started ? (r() < 0.8 ? "LIVE" : "FT") : "NS";
  let minute = started && status==="LIVE" ? randint(1, 48) : null;

  const scoreHome = started ? randint(40, 130) : null;
  const scoreAway = started ? randint(40, 130) : null;

  return {
    id: makeGameId("bb", i),
    sport: "basketball",
    league,
    country,
    home,
    away,
    startTs: tsSecondsFromMs(startMs),
    status,
    minute,
    scoreHome,
    scoreAway,
    odds: { home: null, draw: null, away: null }
  };
}

function volleyballGame(i){
  const [league, country] = pick(volleyballLeagues);
  const home = pick(volleyballTeams);
  let away = pick(volleyballTeams);
  if (away === home) away = pick(volleyballTeams);

  const startMs = nowMs + randint(-90*60*1000, 10*60*60*1000);
  const started = startMs <= nowMs;

  let status = started ? (r() < 0.8 ? "LIVE" : "FT") : "NS";
  let minute = started && status==="LIVE" ? randint(1, 120) : null;

  // sets
  const scoreHome = started ? randint(0, 3) : null;
  const scoreAway = started ? randint(0, 3) : null;

  return {
    id: makeGameId("vb", i),
    sport: "volleyball",
    league,
    country,
    home,
    away,
    startTs: tsSecondsFromMs(startMs),
    status,
    minute,
    scoreHome,
    scoreAway,
    odds: { home: null, draw: null, away: null }
  };
}

function generateAll(){
  const games = [];

  // Total grande (mundo inteiro)
  for (let i=1;i<=220;i++) games.push(footballGame(i));
  for (let i=1;i<=90;i++)  games.push(tennisGame(i));
  for (let i=1;i<=70;i++)  games.push(basketballGame(i));
  for (let i=1;i<=60;i++)  games.push(volleyballGame(i));

  // Ordena por horário
  games.sort((a,b)=> (a.startTs||0) - (b.startTs||0));

  return games;
}

function main(){
  const games = generateAll();
  const payload = {
    updatedAt: new Date().toLocaleString("pt-BR"),
    cacheBust: String(Date.now()),
    source: "DEMO",
    games
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log("DEMO gerado:", games.length);
}

main();
