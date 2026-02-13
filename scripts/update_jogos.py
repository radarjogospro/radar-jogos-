import os
import requests
import json
from datetime import datetime, timedelta

API_KEY = os.getenv("API_FOOTBALL_KEY")

if not API_KEY:
    raise Exception("API_FOOTBALL_KEY não encontrada.")

headers = {
    "x-apisports-key": API_KEY
}

# Data de hoje
today = datetime.utcnow().strftime("%Y-%m-%d")

url = "https://v3.football.api-sports.io/fixtures"
params = {
    "date": today,
    "timezone": "America/Sao_Paulo"
}

response = requests.get(url, headers=headers, params=params)

if response.status_code != 200:
    raise Exception(f"Erro na API: {response.text}")

data = response.json()

games = []

for item in data.get("response", []):
    fixture = item["fixture"]
    league = item["league"]
    teams = item["teams"]

    games.append({
        "home": teams["home"]["name"],
        "away": teams["away"]["name"],
        "league": league["name"],
        "country": league["country"],
        "date": fixture["date"][:10],
        "time": fixture["date"][11:16],
        "status": fixture["status"]["short"]
    })

output = {
    "updatedAt": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    "source": "API-Football",
    "games": games
}

with open("jogos.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("jogos.json atualizado com sucesso.")
