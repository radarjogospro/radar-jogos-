import os
import json
import requests
from datetime import datetime
from zoneinfo import ZoneInfo
import subprocess

# ===== CONFIG =====
API_KEY = os.environ.get("API_FOOTBALL_KEY")
BASE_URL = "https://v3.football.api-sports.io/fixtures"
TZ_BR = ZoneInfo("America/Sao_Paulo")

headers = {
    "x-apisports-key": API_KEY
}

# ===== DATA DE HOJE (BRASIL) =====
today_br = datetime.now(TZ_BR).strftime("%Y-%m-%d")

params = {
    "date": today_br
}

response = requests.get(BASE_URL, headers=headers, params=params)
data_api = response.json()

games = []

if "response" in data_api:
    for item in data_api["response"]:

        fixture_date_utc = item["fixture"]["date"]
        dt_utc = datetime.fromisoformat(fixture_date_utc.replace("Z", "+00:00"))
        dt_br = dt_utc.astimezone(TZ_BR)

        game = {
            "home": item["teams"]["home"]["name"],
            "away": item["teams"]["away"]["name"],
            "league": item["league"]["name"],
            "country": item["league"]["country"],
            "date": dt_br.strftime("%Y-%m-%d"),
            "time": dt_br.strftime("%H:%M"),
            "status": item["fixture"]["status"]["short"]
        }

        games.append(game)

# ===== JSON FINAL =====
output = {
    "updatedAt": datetime.now(TZ_BR).strftime("%Y-%m-%d %H:%M BRT"),
    "source": "API-Football",
    "games": games
}

with open("jogos.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

# ===== COMMIT AUTOMÁTICO =====
subprocess.run(["git", "config", "--global", "user.name", "github-actions[bot]"])
subprocess.run(["git", "config", "--global", "user.email", "github-actions[bot]@users.noreply.github.com"])
subprocess.run(["git", "add", "jogos.json"])
subprocess.run(["git", "commit", "-m", "Update jogos.json (horário Brasil)"])
subprocess.run(["git", "push"])
