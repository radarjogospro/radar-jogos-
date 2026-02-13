import requests
import json
import os
from datetime import datetime
import pytz

API_KEY = os.getenv("API_FOOTBALL_KEY")

today = datetime.utcnow().strftime("%Y-%m-%d")

url = f"https://v3.football.api-sports.io/fixtures?date={today}"

headers = {
    "x-apisports-key": API_KEY
}

response = requests.get(url, headers=headers)
data = response.json()

games = []

if "response" in data:
    for item in data["response"]:
        fixture = item["fixture"]
        league = item["league"]
        teams = item["teams"]

        # Converter horário para Brasil
        utc_time = datetime.fromisoformat(fixture["date"].replace("Z", "+00:00"))
        brazil_tz = pytz.timezone("America/Sao_Paulo")
        brazil_time = utc_time.astimezone(brazil_tz)

        games.append({
            "home": teams["home"]["name"],
            "away": teams["away"]["name"],
            "league": league["name"],
            "country": league["country"],
            "date": brazil_time.strftime("%d/%m/%Y"),
            "time": brazil_time.strftime("%H:%M"),
            "status": fixture["status"]["short"]
        })

output = {
    "updatedAt": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    "source": "API-Football",
    "games": games
}

with open("jogos.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("Jogos atualizados com API-Football com sucesso!")
