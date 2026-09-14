# The coordinator hub

An **optional** service for the unwatched archipelago. Islands are self-sufficient peers that
federate by boats; the hub only makes the world richer. Islands never depend on it — the
two-islands-no-hub floor always works. Full design: [`docs/hub-design.md`](../../docs/hub-design.md).

## v1 (this) — registry + discovery + read-only overview

- Islands self-register (`POST /islands`) and heartbeat (`POST /islands/:id/state`) when they have
  `UW_HUB_URL` set. No `UW_HUB_URL` → they never call the hub.
- The web reads `GET /world/islands`, `GET /world/map`, `GET /world/islands/:id`.
- `GET /` serves a live overview / spectator switcher page (new islands appear as they register).

Later phases (diplomacy, mainland-as-actor, military, coordinated events, the fugitive layer) are
designed in the doc; their `/world/map` fields are already returned empty so the web contract is stable.

## Run

Stdlib Python only (no deps). Env:

| Env | Default | Meaning |
|-----|---------|---------|
| `HUB_PORT` | `4600` | listen port |
| `HUB_SECRET` | _(none)_ | if set, `POST` writes require `X-Hub: <secret>` |
| `HUB_DB` | `/data/hub.db` | sqlite path |
| `HUB_LIVE_SEC` | `360` | seconds since last heartbeat to still count an island "live" |

```
docker build -t uw-hub:latest services/hub
docker run -d --name uw2-hub -v uw2-hub-data:/data -e HUB_SECRET=... uw-hub:latest
```

Islands opt in with `UW_HUB_URL=http://uw2-hub:4600` (+ `UW_HUB_SECRET`, `UW_ISLAND_URL`).
