import fs from "fs";

const KEY = process.env.API_FOOTBALL_KEY || "";
const OUT = "jogos.json";

// Ajuste se você quiser menos/mais jogos no JSON
const MAX_GAMES = 2500;

// Janela anti "jogo de ontem" (em horas)
const KEEP_PAST_HOURS = 6;   // mantém jogos encerrados há até X horas
const KEEP_FUTURE_HOURS = 18; // mantém jogos que começam nas próximas X horas

const BASE = "https://v3.football.api-sports.io";

function pad(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function nowMs(){ return Date.now(); }

function asMsFromFixture(fx){
  // API-Football geralmente manda date ISO em fixture.date
  const iso = fx?.fixture?.date;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function safeNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function apiGet(path, params={}){
  const url = new URL(`${BASE}${path}`);
  for (const [k,v] of Object.entries(params)) if(v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": KEY },
    redirect: "follow"
  });

  // Se a API estourou quota, normalmente vem 429/403.
  if(!res.ok){
    const txt = await res.text().catch(()=> "");
    const err = new Error(`HTTP ${res.status} ${res.statusText} - ${txt.slice(0,200)}`);
    err.name = "HTTP_ERROR";
    err.status = res.status;
    throw err;
  }

  const json = await res.json();

  // API-Football às vezes responde 200 com "errors"/"message" quando a cota estoura.
  const hasErrors = json && typeof json === "object" && json.errors && Object.keys(json.errors).length > 0;
  if(hasErrors){
    const err = new Error(`API body errors: ${JSON.stringify(json.errors).slice(0,200)}`);
    err.name = "API_BODY_ERROR";
    err.apiBody = json;
    throw err;
  }
  if(json && typeof json === "object" && typeof json.message === "string" && json.message){
    const err = new Error(`API message: ${json.message}`);
    err.name = "API_BODY_MESSAGE";
    err.apiBody = json;
    throw err;
  }

  return json;
}

async function main(){
  if(!KEY){
    console.log("[WARN] API_FOOTBALL_KEY não configurada. Não vou sobrescrever jogos.json.");
    process.exit(0);
  }

  const now = new Date();
  const today = ymd(now);

  // pega hoje (e amanhã cedo, dependendo da janela)
  const tz = "America/Sao_Paulo";

  let fixtures = [];

  try{
    // Hoje
    const a = await apiGet("/fixtures", { date: today, timezone: tz });
    fixtures.push(...(a?.response || []));

    // Amanhã (só pra não perder jogos na virada)
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const b = await apiGet("/fixtures", { date: ymd(tomorrow), timezone: tz });
    fixtures.push(...(b?.response || []));
  }catch(e){
    console.warn("[WARN] Falha ao buscar fixtures (provável cota/limite/instabilidade):", e?.message || e);
    // não zera o arquivo quando a API falha
    process.exit(0);
  }

  // Normaliza e filtra por janela de tempo
  const nowT = nowMs();
  const minT = nowT - KEEP_PAST_HOURS * 3600 * 1000;
  const maxT = nowT + KEEP_FUTURE_HOURS * 3600 * 1000;

  const games = fixtures
    .map(fx => {
      const ts = asMsFromFixture(fx);
      const home = fx?.teams?.home?.name || "";
      const away = fx?.teams?.away?.name || "";
      const league = fx?.league?.name || "";
      const country = fx?.league?.country || "";

      const status = fx?.fixture?.status?.short || "";
      const elapsed = safeNumber(fx?.fixture?.status?.elapsed);

      const goalsHome = safeNumber(fx?.goals?.home) ?? 0;
      const goalsAway = safeNumber(fx?.goals?.away) ?? 0;

      const htHome = safeNumber(fx?.score?.halftime?.home);
      const htAway = safeNumber(fx?.score?.halftime?.away);

      // Odds (se vierem no endpoint atual / seu script original já setava)
      // Mantemos as chaves p1/px/p2/o1/ox/o2 pra não quebrar o layout
      const p1 = fx?.prob?.p1 ?? null;
      const px = fx?.prob?.px ?? null;
      const p2 = fx?.prob?.p2 ?? null;

      const o1 = fx?.odds?.o1 ?? null;
      const ox = fx?.odds?.ox ?? null;
      const o2 = fx?.odds?.o2 ?? null;

      const iso = fx?.fixture?.date || null;
      let dateStr = "";
      let timeStr = "";
      if(iso){
        const d = new Date(iso);
        dateStr = ymd(d);
        timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }

      const isLive = ["1H","2H","HT","ET","P","LIVE"].includes(status) || status === "INT";

      return {
        id: fx?.fixture?.id ?? null,
        home, away, league, country,
        date: dateStr,
        time: timeStr,
        kickoffTs: ts,
        status,
        isLive,
        elapsed: elapsed ?? 0,
        scoreHome: goalsHome,
        scoreAway: goalsAway,
        htHome: htHome ?? null,
        htAway: htAway ?? null,
        p1, px, p2, o1, ox, o2
      };
    })
    .filter(g => g.id && g.kickoffTs && g.kickoffTs >= minT && g.kickoffTs <= maxT)
    .sort((a,b) => (a.kickoffTs - b.kickoffTs))
    .slice(0, MAX_GAMES);

  const payload = {
    updatedAt: new Date().toLocaleString("pt-BR", { timeZone: tz }),
    cacheBust: String(Date.now()),
    source: "API-Football",
    games
  };

  // Se não veio nenhum jogo, NÃO sobrescreve o arquivo existente (evita zerar por cota/instabilidade)
  try{
    if(Array.isArray(payload.games) && payload.games.length === 0 && fs.existsSync(OUT)){
      const prev = JSON.parse(fs.readFileSync(OUT, "utf-8"));
      if(prev && Array.isArray(prev.games) && prev.games.length > 0){
        console.warn(`[WARN] payload.games veio vazio; mantendo o ${OUT} anterior com ${prev.games.length} jogos.`);
        prev.updatedAt = payload.updatedAt;
        prev.cacheBust = payload.cacheBust;
        prev.source = payload.source;
        fs.writeFileSync(OUT, JSON.stringify(prev, null, 2), "utf-8");
        process.exit(0);
      }
    }
  }catch(e){
    console.warn("[WARN] Falha ao aplicar safeguard de arquivo anterior:", e?.message || e);
  }

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`[OK] ${OUT} atualizado com ${games.length} jogos.`);
}

main().catch(err => {
  console.error("[FATAL]", err);
  // não “mata” o workflow por causa de instabilidade/cota
  process.exit(0);
});
