import json
import os
import urllib.request
from datetime import datetime, timezone

API = "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d={date}&s=Soccer"

def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "RadarJogosPRO/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def norm(s):
    return (s or "").strip()

def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    url = API.format(date=today)

    data = fetch(url)
    events = data.get("events") or []

    games = []
    for ev in events:
        home = norm(ev.get("strHomeTeam"))
        away = norm(ev.get("strAwayTeam"))
        league = norm(ev.get("strLeague"))
        country = norm(ev.get("strCountry"))
        date_event = norm(ev.get("dateEvent"))
        time_event = norm(ev.get("strTime"))  # geralmente UTC

        if not home or not away:
            continue

        # Um "palpite" neutro só pra preencher UI (sem inventar odds)
        tag = "Jogo do dia"

        games.append({
            "home": home,
            "away": away,
            "league": league or "—",
            "country": country or "—",
            "date": date_event or today,
            "time": time_event or "",
            "tag": tag
        })

    out = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "source": "TheSportsDB eventsday",
        "games": games
    }

    with open("jogos.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
