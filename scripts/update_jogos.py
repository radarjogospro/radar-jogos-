import os
import json
import requests
from datetime import datetime
from zoneinfo import ZoneInfo

API_HOST = "v3.football.api-sports.io"
BASE_URL = f"https://{API_HOST}"
TZ_BR = ZoneInfo("America/Sao_Paulo")

def br_now_iso():
    return datetime.now(TZ_BR).strftime("%Y-%m-%d %H:%M BRT")

def to_br_date_time(iso_utc: str):
    """
    iso_utc: exemplo "2026-02-13T21:00:00+00:00"
    retorna ("YYYY-MM-DD", "HH:MM") em America/Sao_Paulo
    """
    if not iso_utc:
        return "", ""
    try:
        dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
        dt_br = dt.astimezone(TZ_BR)
        return dt_br.strftime("%Y-%m-%d"), dt_br.strftime("%H:%M")
    except Exception:
        return "", ""

def main():
    api_key = os.getenv("APIFOOTBALL_KEY", "").strip()
    if not api_key:
        raise SystemExit("ERRO: secret APIFOOTBALL_KEY não encontrado.")

    headers = {
        "x-apisports-key": api_key,
        "x-rapidapi-host": API_HOST
    }

    # Pega jogos do "dia" no fuso BR (o endpoint usa date YYYY-MM-DD)
    today_br = datetime.now(TZ_BR).strftime("%Y-%m-%d")

    # Endpoint fixtures por data (1 request)
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

        home = (teams.get("home", {}) or {}).get("name", "") or ""
        away = (teams.get("away", {}) or {}).get("name", "") or ""

        league_name = league.get("name", "") or ""
        country = league.get("country", "") or ""

        # date em UTC vem em fixture.date
        fixture_date = fixture.get("date", "") or ""
        date_br, time_br = to_br_date_time(fixture_date)

        status = ((fixture.get("status", {}) or {}).get("short", "") or "").upper()

        if not home or not away:
            continue

        games.append({
            "home": home,
            "away": away,
            "league": league_name,
            "country": country if country else "World",
            "date": date_br if date_br else today_br,
            "time": time_br if time_br else "",
            "status": status
        })

    # ordena por horário
    games.sort(key=lambda g: f"{g.get('date','')} {g.get('time','')}" )

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
