import fs from "fs";

const KEY = process.env.API_FOOTBALL_KEY;
const OUT = "jogos.json";
const BASE = "https://v3.football.api-sports.io";

const HEAD = { "x-apisports-key": KEY };

const now = new Date();
const date = now.toISOString().slice(0,10);

// ---------------- FETCH ----------------
async function fetchFixtures(){
  const url = `${BASE}/fixtures?date=${date}&timezone=America/Sao_Paulo`;

  const res = await fetch(url,{headers:HEAD});
  if(!res.ok) throw new Error("API fail");

  const json = await res.json();
  return json.response || [];
}

// ---------------- NORMALIZE ----------------
function normalize(fx){

  const st = fx.fixture.status.short;
  const elapsed = fx.fixture.status.elapsed;

  let status = "NS";
  if(["1H","2H","HT","LIVE","ET","P"].includes(st)) status="LIVE";
  if(["FT","AET","PEN"].includes(st)) status="FT";

  return {
    id: String(fx.fixture.id),

    sport: "football",
    league: fx.league.name,
    country: fx.league.country,

    home: fx.teams.home.name,
    away: fx.teams.away.name,

    startTs: Math.floor(new Date(fx.fixture.date).getTime()/1000),

    status,
    minute: elapsed ?? null,

    scoreHome: fx.goals.home,
    scoreAway: fx.goals.away,

    odds:{home:null,draw:null,away:null}
  };
}

// ---------------- MAIN ----------------
async function main(){
  try{
    const fixtures = await fetchFixtures();
    const games = fixtures.map(normalize);

    if(games.length===0){
      console.log("API retornou vazio — mantendo snapshot");
      return;
    }

    fs.writeFileSync(OUT, JSON.stringify({games},null,2));
    console.log("Atualizado:",games.length);

  }catch(e){
    console.log("Erro — mantendo snapshot");
  }
}

main();
