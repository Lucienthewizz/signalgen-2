"""Bound actual scheduled workflow attempts even when the database is offline."""
import datetime as dt
import json
import os
import urllib.request

UTC = dt.timezone.utc


def decision(armed, now, automatic_count, event):
    expired = now < armed or now - armed >= dt.timedelta(hours=1)
    exhausted = automatic_count > 6
    return {"collect": not (expired or exhausted),
            "disable": expired or exhausted,
            "automatic_events": automatic_count, "trigger": event}


def main():
    armed = dt.datetime.fromisoformat(os.environ["SMOKE_ARMED_AT"].replace("Z", "+00:00"))
    if armed.tzinfo is None:
        raise ValueError("arm timestamp must include a timezone")
    repository = os.environ["GITHUB_REPOSITORY"]
    query = "?event=schedule&per_page=100"
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/actions/workflows/market-archive-smoke.yml/runs{query}",
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                 "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        runs = json.load(response)["workflow_runs"]
    count = sum(dt.datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")) >= armed
                for run in runs)
    result = decision(armed, dt.datetime.now(UTC), count, os.environ["GITHUB_EVENT_NAME"])
    with open("market-smoke-guard.json", "w") as report:
        json.dump(result, report, indent=2)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for key in ("collect", "disable"):
            output.write(f"{key}={str(result[key]).lower()}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
