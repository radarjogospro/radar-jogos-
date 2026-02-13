import os
import json
import math
import requests
from datetime import datetime
from zoneinfo import ZoneInfo

API_HOST = "v3.football.api-sports.io"
BASE_URL = f"https://{API_HOST}"
TZ_BR = ZoneInfo("America/Sao_Paulo")

# Modelo simples (modo leve, 1 request por execução).
# Média de gols "global" (padrão futebol): ajuste depois se quiser.
LAMBDA_GOALS_DEFAULT = 2.6

LIVE_STATUSES = {"1H", "2H", "HT", "ET", "P", "LIVE"}  # API-Football usa 'P' em alguns contextos (penalties)
FINISHED_STATUSES = {"FT", "AET", "PEN"}

def br_now_iso():
  return datetime.now(TZ_BR).strftime("%Y-%m-%d %H:%M BRT")

def to_br_date_time(iso_utc: str):
  if not iso_utc:
    return "", ""
  try:
    dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    dt_br = dt.astimezone(TZ_BR)
    return dt_br.strftime("%Y-%m-%d"), dt_br.strftime("%H:%M")
  except Exception:
    return "", ""

def poisson_pmf(k: int, lam: float) -> float:
  return math.exp(-lam) * (lam ** k) / math.factorial(k)

def prob_over(line: float, lam: float) -> float:
  """
  line 1.5 => P(G>=2)
  line 2.5 => P(G>=3)
  """
  threshold = int(math.floor(line) + 1)  # 1.5 -> 2, 2.5 -> 3
  # P(G>=threshold) = 1 - sum_{k=0..threshold-1} pmf(k)
  s = 0.0
  for k in range(threshold):
    s += poisson_pmf(k, lam)
  return max(0.0, min(1.0, 1.0 - s))

def prob_under(line: float, lam: float) -> float:
  return max(0.0, min(1.0, 1.0 - prob_over(line, lam)))

def fair_odds(p: float) -> float:
  if p <= 0:
    return 999.0
  return round(1.0 / p, 2)

def pct(p: float) -> int:
  return int(round(p * 100))

def main():
  api_key = os.getenv("APIFOOTBALL_KEY", "").strip()
  if not api_key:
    raise SystemExit("ERRO: secret APIFOOTBALL_KEY não encontrado.")

  headers = {
    "x-apisports-key": api_key,
    "x-rapidapi-host": API_HOST
  }

  today_br = datetime.now(TZ_BR).strftime("%Y-%m-%d")

  url = f"{BASE_URL}/fixtures"
  params = {"date": today_br}

  r = requests.get(url, headers=headers, params=params, timeout=40)
  if r.status_code != 200:
    raise SystemExit(f"ERRO API-Football: HTTP {r.status_code} - {r.text[:300]}")

  data = r.json()
  resp = data.get("response", [])

  games = []
  for item in resp:
    fixture = item.get("fixture", {}) or {}
    teams = item.get("teams", {}) or {}
    league = item.get("league", {}) or {}
    goals = item.get("goals", {}) or {}

    home = (teams.get("home", {}) or {}).get("name", "") or ""
    away = (teams.get("away", {}) or {}).get("name", "") or ""

    league_name = league.get("name", "") or ""
    country = league.get("country", "") or ""

    fixture_date = fixture.get("date", "") or ""
    date_br, time_br = to_br_date_time(fixture_date)

    status = ((fixture.get("status", {}) or {}).get("short", "") or "").upper()

    if not home or not away:
      continue

    # Live info (placar atual quando existir)
    home_goals = goals.get("home", None)
    away_goals = goals.get("away", None)
    if isinstance(home_goals, int) and isinstance(away_goals, int):
      total_goals_now = home_goals + away_goals
    else:
      total_goals_now = None

    # Probabilidades (pré-jogo / modo leve)
    lam = LAMBDA_GOALS_DEFAULT

    p_o15 = prob_over(1.5, lam)
    p_u15 = prob_under(1.5, lam)
    p_o25 = prob_over(2.5, lam)
    p_u25 = prob_under(2.5, lam)

    games.append({
      "home": home,
      "away": away,
      "league": league_name,
      "country": country if country else "World",
      "date": date_br if date_br else today_br,
      "time": time_br if time_br else "",
      "status": status,

      # Live (quando houver)
      "scoreHome": home_goals if isinstance(home_goals, int) else None,
      "scoreAway": away_goals if isinstance(away_goals, int) else None,

      # Probabilidades estimadas + odds justas (NÃO é odd de casa)
      "model": {
        "lambdaGoals": lam,
        "over15": {"p": round(p_o15, 4), "pct": pct(p_o15), "fairOdds": fair_odds(p_o15)},
        "under15": {"p": round(p_u15, 4), "pct": pct(p_u15), "fairOdds": fair_odds(p_u15)},
        "over25": {"p": round(p_o25, 4), "pct": pct(p_o25), "fairOdds": fair_odds(p_o25)},
        "under25": {"p": round(p_u25, 4), "pct": pct(p_u25), "fairOdds": fair_odds(p_u25)},
      },

      # Flags úteis pro front
      "isLive": status in LIVE_STATUSES,
      "isFinished": status in FINISHED_STATUSES
    })

  games.sort(key=lambda g: f"{g.get('date','')} {g.get('time','')}")

  out = {
    "updatedAt": br_now_iso(),
    "source": "API-Football",
    "games": games
  }

  with open("jogos.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

  print(f"OK: jogos.json gerado com {len(games)} jogos. Data BR: {today_br}")

if __name__ == "__main__":
  main()
