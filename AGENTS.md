# Balloon Water Race

A carnival water-gun game built with Cloudflare Python Workers + Durable Objects for PyCon. Players use their phone cameras to aim at colored clown mouth targets on a big screen. Auto-fire fills balloons until they pop!

## Architecture

- **Python Worker** (`src/entry.py`): Entry point + `BalloonGame` Durable Object
- **Durable Object per game**: Isolated state, WebSocket hibernation, SQLite storage
- **Static assets** (`assets/`): Served via `env.ASSETS.fetch()`
- **No filesystem reads at runtime** — always use `env.ASSETS.fetch(Request(...))`

## Pages

| URL | Purpose |
|-----|---------|
| `/` | Create game landing page |
| `/game/<id>` | Presenter screen (canvas + scoreboard) |
| `/player/<id>` | Phone camera controller |
| `/ws/<id>` | WebSocket to Durable Object |

## Key Technical Details

### DO Storage
- Game state stored as JSON string via `self.ctx.storage.put("game_state", json.dumps(state))`
- **Never use `to_js()`** — causes `DataCloneError: [object Map] could not be cloned`
- SQLite available via `self.ctx.storage.sql.exec()` for persistent data

### SQLite Cursor Pattern
```python
cursor = self.ctx.storage.sql.exec("SELECT name, score FROM high_scores")
js_array = getattr(js.Array, 'from')(cursor)
py_rows = js_array.to_py()  # Converts to list of dicts
for row in py_rows:
    name = row.get("name")  # Column name as key
    score = row.get("score")
```

### Response kwargs use snake_case
```python
return Response(None, status=101, web_socket=client)  # NOT webSocket
```

### WebSocket Hibernation
- `self.ctx.acceptWebSocket(server)` to accept
- `server.serializeAttachment(sid)` to store session ID
- `self.ctx.setWebSocketAutoResponse(WebSocketRequestResponsePair.new("ping", "pong"))`
- On hibernation wake: iterate `self.ctx.getWebSockets()` and rehydrate sessions

## Game Flow

1. Presenter creates game → gets unique game ID
2. Players scan QR code → join via `/player/<id>`
3. Phone camera starts immediately (practice aiming)
4. Presenter hits `SPACE` → 3-2-1 countdown
5. Game active → auto-fire when color lock detected
6. Balloon pops → 💥 → confetti → 👑 crown on winner
7. Game pauses → Hall of Fame updates
8. Presenter hits `SPACE` again → new round (resets balloons)

## Asset Files

- `home.html` — Landing page with carnival emoji story
- `game.html` — Presenter screen with canvas, scoreboard, QR code, debug panel
- `game.js` — Canvas rendering, confetti, explosions, orange balloons, scoreboard
- `player.html` — Full-screen camera with overlays
- `player.js` — Color detection, auto-fire, zoom controls, haptic feedback
- `style.css` — Shared styles + phone/presenter specific layouts

## Development

```bash
# Install dependencies
uv sync

# Local dev (uses wrangler dev)
npm run dev

# Deploy
npm run deploy
```

## Config

`wrangler.jsonc`:
- `assets` binding for static files
- `BALLOON_GAME` Durable Object with `new_sqlite_classes` migration
- `observability.logs.enabled: true` for debugging
