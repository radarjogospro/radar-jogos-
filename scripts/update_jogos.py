
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
