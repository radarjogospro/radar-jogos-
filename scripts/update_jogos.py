import os
import json
import math
from datetime import datetime, timedelta, timezone

import requests


API_KEY = os.getenv("API_FOOTBALL_KEY", "").strip()
BASE_URL = "https://v3.football.api-sports.io"

TZ_OFFSET_HOURS = -3  # BRT
TZ = timezone(timedelta(hours=TZ_OFFSET_HOURS))

# Janela de jogos: pega do "agora - 90min" até "agora + 12h" (e sempre inclui ao vivo)
PAST_GRACE_MIN = 90
FUTURE_WINDOW_HOURS = 12

# Para não estourar o FREE: calcula probabilidades só para os primeiros N jogos após filtros (Brasil/Europa/ao vivo priorizados)
MAX_PROB_GAMES = 25


def api_get(path: str, params: dict):
    if not API_KEY:
        raise RuntimeError("API_FOOTBALL_KEY não configurada (GitHub Secrets).")
    headers = {"x-apisports-key": API_KEY}
    r = requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def now_brt():
    return datetime.now(TZ)


def iso_brt(dt: datetime) -> str:
    return dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M BRT")


def poisson_cdf(k: int, lam: float) -> float:
    # P(X <= k)
    if lam <= 0:
        return 1.0 if k >= 0 else 0.0
    s = 0.0
    for i in range(0, k + 1):
        s += math.exp(-lam) * (lam ** i) / math.factorial(i)
    return s


def prob_over(threshold: float, lam_total: float) -> float:
    # threshold: 1.5 => over = P(total >= 2)
    # total goals is integer; over 1.5 means >=2; over 2.5 means >=3
    if threshold == 1.5:
        return 1.0 - poisson_cdf(1, lam_total)
    if threshold == 2.5:
        return 1.0 - poisson_cdf(2, lam_total)
    return 0.0


def prob_under(threshold: float, lam_total: float) -> float:
    # under 1.5 => <=1; under 2.5 => <=2
    if threshold == 1.5:
        return poisson_cdf(1, lam_total)
    if threshold == 2.5:
        return poisson_cdf(2, lam_total)
    return 0.0


def fair_odd(p: float) -> float:
    if p <= 0:
        return 999.0
    return 1.0 / p


def safe_round_odd(x: float) -> float:
    # arredondamento estilo casa (2 casas)
    return round(x + 1e-9, 2)


def team_last3_stats(team_id: int, season: int) -> dict:
    # últimos 3 jogos finalizados do time
    data = api_get("/fixtures", {
        "team": team_id,
        "season": season,
        "last": 3,
        "status": "FT-AET-PEN",  # finalizados
        "timezone": "America/Sao_Paulo",
    })
    fixtures = data.get("response", [])
    if not fixtures:
        return {"gf": 0.0, "ga": 0.0, "n": 0}

    gf = 0
    ga = 0
    n = 0
    for fx in fixtures:
        teams = fx.get("teams", {})
        goals = fx.get("goals", {})

        home = teams.get("home", {})
        away = teams.get("away", {})
        gh = goals.get("home")
        ga_ = goals.get("away")

        if gh is None or ga_ is None:
            continue

        if home.get("id") == team_id:
            gf += int(gh)
            ga += int(ga_)
            n += 1
        elif away.get("id") == team_id:
            gf += int(ga_)
            ga += int(gh)
            n += 1

    if n == 0:
        return {"gf": 0.0, "ga": 0.0, "n": 0}

    return {"gf": gf / n, "ga": ga / n, "n": n}


def estimate_probs(home_stats: dict, away_stats: dict) -> dict:
    # modelo simples: lambda_home = média(gf_home, ga_away)
    #               lambda_away = média(gf_away, ga_home)
    if home_stats.get("n", 0) == 0 or away_stats.get("n", 0) == 0:
        return {}

    lam_home = (home_stats["gf"] + away_stats["ga"]) / 2.0
    lam_away = (away_stats["gf"] + home_stats["ga"]) / 2.0
    lam_total = max(0.05, lam_home + lam_away)

    p_o15 = prob_over(1.5, lam_total)
    p_o25 = prob_over(2.5, lam_total)
    p_u15 = prob_under(1.5, lam_total)
    p_u25 = prob_under(2.5, lam_total)

    return {
        "over15": {"p": round(p_o15 * 100, 1), "odd": safe_round_odd(fair_odd(p_o15))},
        "over25": {"p": round(p_o25 * 100, 1), "odd": safe_round_odd(fair_odd(p_o25))},
        "under15": {"p": round(p_u15 * 100, 1), "odd": safe_round_odd(fair_odd(p_u15))},
        "under25": {"p": round(p_u25 * 100, 1), "odd": safe_round_odd(fair_odd(p_u25))},
        "model": "last3_poisson",
        "lam_total": round(lam_total, 2),
    }


def is_live(status_short: str) -> bool:
    # API-Football: 1H, HT, 2H, ET, P, BT etc
    return status_short in {"1H", "HT", "2H", "ET", "P", "BT"}


def main():
    now = now_brt()
    start = now - timedelta(minutes=PAST_GRACE_MIN)
    end = now + timedelta(hours=FUTURE_WINDOW_HOURS)

    today = now.strftime("%Y-%m-%d")

    # 1) Busca jogos do dia (timezone SP)
    day_data = api_get("/fixtures", {
        "date": today,
        "timezone": "America/Sao_Paulo",
    })
    day_fixtures = day_data.get("response", [])

    # 2) Busca ao vivo separado (garante pegar mesmo se a janela cortar)
    live_data = api_get("/fixtures", {
        "live": "all",
        "timezone": "America/Sao_Paulo",
    })
    live_fixtures = live_data.get("response", [])

    # Index live por id
    live_ids = set()
    for fx in live_fixtures:
        fid = fx.get("fixture", {}).get("id")
        if fid:
            live_ids.add(fid)

    games = []
    for fx in day_fixtures:
        fixture = fx.get("fixture", {})
        teams = fx.get("teams", {})
        league = fx.get("league", {})
        goals = fx.get("goals", {})

        fid = fixture.get("id")
        dt_str = fixture.get("date")  # ISO
        if not dt_str:
            continue

        # parse ISO
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).astimezone(TZ)

        status_short = fixture.get("status", {}).get("short", "")
        live = (fid in live_ids) or is_live(status_short)

        # filtro janela: se não for ao vivo, só se estiver na janela
        if not live:
            if dt < start or dt > end:
                continue

        home = teams.get("home", {})
        away = teams.get("away", {})

        item = {
            "id": fid,
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "ts": int(dt.timestamp()),
            "status": status_short,
            "live": bool(live),
            "home": home.get("name", ""),
            "away": away.get("name", ""),
            "homeId": home.get("id"),
            "awayId": away.get("id"),
            "league": league.get("name", ""),
            "leagueId": league.get("id"),
            "country": league.get("country", ""),
            "season": league.get("season"),
            "round": league.get("round", ""),
        }

        # placar só se ao vivo
        if live:
            gh = goals.get("home")
            ga_ = goals.get("away")
            if gh is not None and ga_ is not None:
                item["score"] = {"home": gh, "away": ga_}

        games.append(item)

    # Ordena: ao vivo primeiro, depois por horário
    games.sort(key=lambda g: (0 if g["live"] else 1, g["ts"]))

    # 3) Probabilidades (limitadas)
    # pega os primeiros MAX_PROB_GAMES (prioriza ao vivo e BR/Europa pela ordenação + filtro da UI)
    # mas aqui é geral: não explode requisições.
    team_cache = {}
    prob_done = 0

    for g in games:
        if prob_done >= MAX_PROB_GAMES:
            break

        home_id = g.get("homeId")
        away_id = g.get("awayId")
        season = g.get("season")

        if not home_id or not away_id or not season:
            continue

        # cache
        key_h = (home_id, season)
        key_a = (away_id, season)
        if key_h not in team_cache:
            team_cache[key_h] = team_last3_stats(home_id, season)
        if key_a not in team_cache:
            team_cache[key_a] = team_last3_stats(away_id, season)

        probs = estimate_probs(team_cache[key_h], team_cache[key_a])
        if probs:
            g["probs"] = probs
            prob_done += 1

    out = {
        "updatedAt": iso_brt(now),
        "source": "API-Football",
        "window": {
            "from": iso_brt(start),
            "to": iso_brt(end),
            "note": "Lista mostra jogos dentro da janela (agora-90min até +12h) + ao vivo.",
        },
        "counts": {
            "games": len(games),
            "probGames": prob_done,
            "maxProbGames": MAX_PROB_GAMES,
        },
        "games": games,
    }

    with open("jogos.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
