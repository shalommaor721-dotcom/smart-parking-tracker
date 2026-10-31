# AI Usage Documentation

We used an AI assistant (Claude) to help build this project. We went through the code and are responsible for understanding it (see the "Code review cheat sheet" in the README).

## Prompts sent to the AI

1. _"Build Track 2 (Full Stack DevOps) of the Smart Parking License Plate Tracker assignment: Nginx web server with a JavaScript dashboard using fetch, a Redis DB with persistence, and an API backend with a POST endpoint for the camera and a GET endpoint for the dashboard. Use Docker Compose and a volume."_
2. _"Add a GitHub Actions workflow that checks the Docker build on every push, plus the bonus: login to ghcr.io with GITHUB_TOKEN, automatic image tagging and push."_
3. _"Add our own personal touch: parking fee by hours, Full Capacity Alert, a release button, Dark Mode and an Easter egg."_

> ✏️ **Team:** add here any additional prompts you send to the AI while working on the project.

## Example of an AI inaccuracy and how we fixed it

**Problem:** In the first version of `POST /api/plates` the AI checked *"is the lot full?"* **before** *"is this car already inside?"*.
While testing with a lot of capacity 3 (full), we sent a plate that was already parked and got `409 Parking lot is FULL`
instead of `409 Car is already inside` - a misleading error for the camera, and a wrong `rejected_full` entry in the event log.

**How we found it:** manual test with `curl` against the API with Redis running.

**Fix:** we swapped the order in `api/server.js` - the duplicate check (`ZSCORE`) now runs first, then the capacity check (`ZCARD`).
We re-ran the same test and got the correct `Car is already inside`.

## Things we verified ourselves

- API tested with `curl`: valid plate (201), invalid plate (400), duplicate (409), full lot (409), release with fee.
- Redis persistence: data was still there after restarting Redis with AOF enabled.

> ✏️ **Team:** if you find another mistake the AI made while you work, add it here too - the lecturer wants at least one real example from your own work.
