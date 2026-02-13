import os
import json
import math
import time
import requests
from datetime import datetime
from zoneinfo import ZoneInfo

API_BASE = "https://v3.football.api-sports.io"


def poisson_over_probs(lmbda: float):
    # Probabilidades (modelo Poisson simples, total de gols)
    # Over 1.5 = 1 - P(0) - P(1)
    # Over 2.5 = 1 - P(0) - P(1) - P(2)
    p0 = math.exp(-lmbda)
    p1 = p0 * lmbda
    p2 = p1 * lmbda / 2.0

    over15 = 1.0 - (p0 + p1)
    over25 = 1.0 - (p0 + p1 + p2)
    under15 = 1.0 - over15
    under25 = 1.0 - over25

    def clamp(x):  # só pra segurança
        return max(0.0, min(1.0, x))

    return {
        "over15": clamp(over15),
        "over25": clamp(over25),
        "under15": clamp(under15),
        "under25": clamp(under25),
    }


def fair_odds(p: float):
    if p <= 0:
        return None
    return round(1.0 / p, 2)


def safe_get(d, path, default=None):
    cur = d
    for k in path:
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            return default
    return cur


def main():
    key = os.getenv("APIFOOTBALL_KEY", "").strip()
    if not key:
        # Não quebra action: gera JSON com erro e sai 0 (pra não ficar vermelho)
        payload = {
            "updatedAt": datetime.now(tz=ZoneInfo("America/Sao_Paulo")).strftime("%Y-%m-%d %H:%M:%S BRT"),
            "source": "API-Football",
            "error": "APIFOOTBALL_KEY não encontrado nas Secrets do GitHub",
            "games": []
        }
        with open("jogos.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("ERRO: APIFOOTBALL_KEY não encontrado.")
        return

    tz = "America/Sao_Paulo"
    now_sp = datetime.now(tz=ZoneInfo(tz))
    today = now_sp.strftime("%Y-%m-%d")

    headers = {
        "x-apisports-key": key,
        "accept": "application/json",
    }

    # Puxa SOMENTE o dia (BRT) e já pede timezone São Paulo
    url = f"{API_BASE}/fixtures"
    params = {
        "date": today,
        "timezone": tz,
    }

    try:
        r = requests.get(url, headers=headers, params=params, timeout=25)
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
    except Exception as e:
        payload = {
            "updatedAt": now_sp.strftime("%Y-%m-%d %H:%M:%S BRT"),
            "source": "API-Football",
            "error": f"Falha ao consultar fixtures: {str(e)}",
            "games": []
        }
        with open("jogos.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("ERRO ao consultar API:", e)
        return

    # Modelo simples de probabilidade de gols (sem odds de casa)
    # Você pode ajustar depois (2.4, 2.6, 2.8) conforme quiser.
    BASE_LAMBDA_TOTAL_GOALS = 2.6
    probs = poisson_over_probs(BASE_LAMBDA_TOTAL_GOALS)

    games = []
    for item in data.get("response", []):
        fixture = item.get("fixture", {}) or {}
        teams = item.get("teams", {}) or {}
        league = item.get("league", {}) or {}
        goals = item.get("goals", {}) or {}
        status = safe_get(fixture, ["status", "short"], "") or ""
        minute = safe_get(fixture, ["status", "elapsed"], None)

        dt_iso = fixture.get("date")  # já vem no timezone pedido (SP)
        # dt_iso ex: 2026-02-13T21:00:00-03:00
        date_str = today
        time_str = ""
        try:
            dt = datetime.fromisoformat(dt_iso.replace("Z", "+00:00"))
            # garante timezone SP
            dt_sp = dt.astimezone(ZoneInfo(tz))
            date_str = dt_sp.strftime("%Y-%m-%d")
            time_str = dt_sp.strftime("%H:%M")
        except Exception:
            # fallback
            time_str = safe_get(fixture, ["date"], "")[:16]

        home = safe_get(teams, ["home", "name"], "Home")
        away = safe_get(teams, ["away", "name"], "Away")

        country = league.get("country") or ""
        league_name = league.get("name") or ""
        league_id = league.get("id")
        fixture_id = fixture.get("id")

        gh = goals.get("home")
        ga = goals.get("away")
        if gh is None:
            gh = 0
        if ga is None:
            ga = 0

        # Tags / destaque simples
        tag = "Jogo do dia" if league_name and ("Brazil" in country or "Brasileiro" in league_name) else ""

        game = {
            "id": fixture_id,
            "home": home,
            "away": away,
            "league": league_name,
            "leagueId": league_id,
            "country": country,
            "date": date_str,
            "time": time_str,
            "timezone": "BRT",
            "status": status,   # NS, 1H, HT, 2H, FT, etc.
            "minute": minute,   # pode ser None
            "score": {
                "home": gh,
                "away": ga
            },
            "tag": tag,
            "prob": {
                "over15": round(probs["over15"] * 100, 1),
                "over25": round(probs["over25"] * 100, 1),
                "under15": round(probs["under15"] * 100, 1),
                "under25": round(probs["under25"] * 100, 1),
                "fairOdds": {
                    "over15": fair_odds(probs["over15"]),
                    "over25": fair_odds(probs["over25"]),
                    "under15": fair_odds(probs["under15"]),
                    "under25": fair_odds(probs["under25"]),
                },
                "note": "Estimativa (odd justa) via modelo Poisson simples; não é odd de casa."
            }
        }
        games.append(game)

    # Ordena: ao vivo primeiro, depois por horário
    live_status = {"1H", "HT", "2H", "ET", "P", "BT", "LIVE"}
    def sort_key(g):
        is_live = 0 if g.get("status") in live_status else 1
        return (is_live, g.get("time") or "99:99", g.get("league") or "", g.get("home") or "")

    games.sort(key=sort_key)

    payload = {
        "updatedAt": now_sp.strftime("%Y-%m-%d %H:%M:%S BRT"),
        "source": "API-Football",
        "date": today,
        "timezone": "America/Sao_Paulo",
        "gamesCount": len(games),
        "games": games
    }

    with open("jogos.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print("OK - jogos.json gerado:", len(games), "jogos")


if __name__ == "__main__":
    main()
