from workers import WorkerEntrypoint, Response, DurableObject, Request
from js import WebSocketPair, WebSocketRequestResponsePair, Date
import js
from urllib.parse import urlparse
import json
import uuid

CLOWNS = [
    {"id": 0, "name": "Bozo", "color": [255, 20, 147], "fill": 0, "max_fill": 600, "popped": False},
    {"id": 1, "name": "Chuckles", "color": [0, 255, 0], "fill": 0, "max_fill": 600, "popped": False},
    {"id": 2, "name": "Sprinkles", "color": [0, 200, 255], "fill": 0, "max_fill": 600, "popped": False},
    {"id": 3, "name": "Wiggles", "color": [255, 255, 0], "fill": 0, "max_fill": 600, "popped": False},
    {"id": 4, "name": "Puddles", "color": [160, 32, 240], "fill": 0, "max_fill": 600, "popped": False},
]


def default_state():
    return {"clowns": [dict(c) for c in CLOWNS], "players": {}, "game_active": False}


def _get_row_value(row, col_name):
    """Extract a value from a SQLite row.

    SQLite cursors converted via to_py() return plain Python dicts
    with column names as string keys.
    """
    return row.get(col_name)


def _sql_rows(cursor):
    """Convert a SQLite cursor to a list of Python dicts.
    Uses js.Array.from(cursor) then to_py() as documented in AGENTS.md."""
    js_array = getattr(js.Array, 'from')(cursor)
    return js_array.to_py()


class BalloonGame(DurableObject):
    def __init__(self, ctx, env):
        super().__init__(ctx, env)
        self.sessions = {}
        for ws in self.ctx.getWebSockets():
            sid = ws.deserializeAttachment()
            if sid:
                self.sessions[sid] = ws
        self.ctx.setWebSocketAutoResponse(
            WebSocketRequestResponsePair.new("ping", "pong")
        )
        # Initialize SQLite table for persistent high scores (educational!)
        self._init_high_scores_table()

    def _init_high_scores_table(self):
        try:
            self.ctx.storage.sql.exec("""
                CREATE TABLE IF NOT EXISTS high_scores (
                    name TEXT PRIMARY KEY,
                    score INTEGER NOT NULL DEFAULT 0,
                    last_updated INTEGER NOT NULL
                )
            """)
        except Exception as e:
            print("SQLite init failed:", e)

    def _save_high_scores_sqlite(self, players):
        """Save player scores to SQLite - persists across rounds and disconnections!"""
        try:
            now = Date.now()
            for p in players.values():
                name = p.get("name", "Anonymous")
                score = p.get("score", 0)
                if score <= 0:
                    continue
                rows = _sql_rows(
                    self.ctx.storage.sql.exec(
                        "SELECT score FROM high_scores WHERE name = ?", name
                    )
                )
                existing_score = 0
                if rows:
                    val = _get_row_value(rows[0], "score")
                    if val is not None:
                        existing_score = int(val)
                if existing_score > 0:
                    if score > existing_score:
                        self.ctx.storage.sql.exec(
                            "UPDATE high_scores SET score = ?, last_updated = ? WHERE name = ?",
                            score, now, name
                        )
                else:
                    self.ctx.storage.sql.exec(
                        "INSERT INTO high_scores (name, score, last_updated) VALUES (?, ?, ?)",
                        name, score, now
                    )
        except Exception as e:
            print("SQLite save failed:", e)

    def _get_high_scores_sqlite(self, limit=10):
        """Query top all-time scores from SQLite"""
        try:
            rows = _sql_rows(
                self.ctx.storage.sql.exec(
                    "SELECT name, score FROM high_scores ORDER BY score DESC LIMIT ?",
                    limit
                )
            )
            results = []
            for row in rows:
                name_val = _get_row_value(row, "name")
                score_val = _get_row_value(row, "score")
                if name_val is not None and score_val is not None:
                    results.append({"name": str(name_val), "score": int(score_val)})
            return results
        except Exception as e:
            print("SQLite query failed:", e)
            return []

    async def fetch(self, request):
        url = urlparse(request.url)
        path = url.path

        pair = WebSocketPair.new()
        client, server = pair.object_values()
        self.ctx.acceptWebSocket(server)
        sid = str(uuid.uuid4())
        server.serializeAttachment(sid)
        self.sessions[sid] = server

        state = await self._get_state()
        server.send(json.dumps({"type": "state", "data": state}))
        return Response(None, status=101, web_socket=client)

    async def webSocketMessage(self, ws, message):
        sid = ws.deserializeAttachment()
        if not sid:
            return
        try:
            data = json.loads(message)
        except Exception:
            return

        action = data.get("action")

        if action == "join":
            name = data.get("name", "Anonymous")
            state = await self._get_state()
            state["players"][sid] = {
                "name": name,
                "score": 0,
                "last_target": None,
                "last_shot_time": 0,
                "clowns_shot": [],
            }
            await self._save_state(state)
            ws.send(json.dumps({"type": "joined", "name": name, "session_id": sid}))
            await self._broadcast_state()

        elif action == "start_game":
            state = await self._get_state()
            # Reset all balloons for a new round
            for c in state["clowns"]:
                c["fill"] = 0
                c["popped"] = False
            state["game_active"] = True
            # Clear per-round tracking for all players
            for p in state.get("players", {}).values():
                p["clowns_shot"] = []
                p["last_target"] = None
                p["last_shot_time"] = 0
            await self._save_state(state)
            await self._broadcast_state()

        elif action == "shoot":
            clown_id = data.get("clown_id")
            if clown_id is None:
                return
            state = await self._get_state()
            if not state.get("game_active", False):
                return
            clowns = state["clowns"]
            if clown_id < 0 or clown_id >= len(clowns):
                return
            if clowns[clown_id]["popped"]:
                return

            player = state["players"].get(sid)
            if player:
                player["score"] += 1
                player["last_target"] = clown_id
                player["last_shot_time"] = Date.now()
                # Track which clowns this player has shot this round
                if clown_id not in player.get("clowns_shot", []):
                    player["clowns_shot"].append(clown_id)
                clowns[clown_id]["fill"] += 1

                if clowns[clown_id]["fill"] >= clowns[clown_id]["max_fill"]:
                    clowns[clown_id]["popped"] = True
                    state["game_active"] = False  # Game over when balloon pops
                    await self._save_state(state)

                    # Award +100 bonus to anyone who shot the winning clown
                    bonuses = {}
                    for p in state["players"].values():
                        if clown_id in p.get("clowns_shot", []):
                            p["score"] += 100
                            bonuses[p["name"]] = 100

                    # Save to SQLite! Scores persist even after players leave
                    self._save_high_scores_sqlite(state["players"])
                    all_time = self._get_high_scores_sqlite(10)

                    await self._broadcast(
                        json.dumps(
                            {
                                "type": "balloon_popped",
                                "clown_id": clown_id,
                                "popped_by": player["name"],
                                "leaderboard": self._top_3(state),
                                "all_time": all_time,
                                "bonuses": bonuses,
                            }
                        )
                    )
                    await self._broadcast_state()
                else:
                    await self._save_state(state)
                    await self._broadcast_state()

    async def webSocketClose(self, ws, code, reason, wasClean):
        sid = ws.deserializeAttachment()
        if sid and sid in self.sessions:
            del self.sessions[sid]
        state = await self._get_state()
        if sid in state.get("players", {}):
            del state["players"][sid]
            await self._save_state(state)
            await self._broadcast_state()

    async def webSocketError(self, ws, error):
        sid = ws.deserializeAttachment()
        if sid and sid in self.sessions:
            del self.sessions[sid]
        state = await self._get_state()
        if sid in state.get("players", {}):
            del state["players"][sid]
            await self._save_state(state)
            await self._broadcast_state()

    async def alarm(self, alarm_info=None):
        now = Date.now()
        state = await self._get_state()
        resets = await self._get_resets()

        changed = False
        keys_to_remove = []
        for cid, reset_time in list(resets.items()):
            if now >= reset_time:
                idx = int(cid)
                if 0 <= idx < len(state["clowns"]):
                    state["clowns"][idx]["fill"] = 0
                    state["clowns"][idx]["popped"] = False
                    changed = True
                keys_to_remove.append(cid)

        for k in keys_to_remove:
            del resets[k]

        if changed:
            await self._save_state(state)
            await self._broadcast_state()

        await self._save_resets(resets)

        if resets:
            next_alarm = min(resets.values())
            if next_alarm > now:
                self.ctx.storage.setAlarm(next_alarm)

    async def _get_state(self):
        raw = await self.ctx.storage.get("game_state")
        if raw is None:
            state = default_state()
            await self._save_state(state)
            return state
        if isinstance(raw, str):
            return json.loads(raw)
        if hasattr(raw, "to_py"):
            return raw.to_py()
        return raw

    async def _save_state(self, state):
        await self.ctx.storage.put("game_state", json.dumps(state))

    async def _get_resets(self):
        raw = await self.ctx.storage.get("resets")
        if raw is None:
            return {}
        if isinstance(raw, str):
            return json.loads(raw)
        if hasattr(raw, "to_py"):
            return raw.to_py()
        return raw

    async def _save_resets(self, resets):
        await self.ctx.storage.put("resets", json.dumps(resets))

    def _top_3(self, state):
        players = list(state.get("players", {}).values())
        players.sort(key=lambda x: x.get("score", 0), reverse=True)
        return players[:3]

    async def _broadcast_state(self):
        state = await self._get_state()
        now = Date.now()
        # Count active shooters per clown (shot in last 500ms)
        active_shooters = [0] * len(state["clowns"])
        for player in state.get("players", {}).values():
            lt = player.get("last_target")
            lst = player.get("last_shot_time", 0)
            if lt is not None and now - lst < 500:
                if 0 <= lt < len(active_shooters):
                    active_shooters[lt] += 1
        # Get persistent all-time scores from SQLite
        all_time = self._get_high_scores_sqlite(10)
        payload = {
            "type": "state",
            "data": state,
            "active_shooters": active_shooters,
            "all_time": all_time,
        }
        await self._broadcast(json.dumps(payload))

    async def _broadcast(self, message):
        for sid, ws in list(self.sessions.items()):
            try:
                if ws.readyState == 1:
                    ws.send(message)
            except Exception:
                pass


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = urlparse(request.url)
        path = url.path

        # Create a new game
        if path == "/create" and request.method == "POST":
            game_id = str(uuid.uuid4())[:8]
            return Response.json({"game_id": game_id}, status=201)

        # WebSocket for a specific game
        if path.startswith("/ws/"):
            game_id = path[4:]  # Remove "/ws/"
            if not game_id:
                return Response("Game ID required", status=400)
            upgrade = request.headers.get("Upgrade")
            if not upgrade or upgrade != "websocket":
                return Response("Expected websocket", status=426)
            if request.method != "GET":
                return Response("Expected GET", status=400)
            stub = self.env.BALLOON_GAME.getByName(game_id)
            return await stub.fetch(request)

        # Serve home page
        if path == "/":
            return await self.env.ASSETS.fetch(
                Request("https://placeholder/home.html", method="GET")
            )

        # Serve game presenter page
        if path.startswith("/game/"):
            return await self.env.ASSETS.fetch(
                Request("https://placeholder/game.html", method="GET")
            )

        # Serve player page (with or without game ID)
        if path == "/player" or path.startswith("/player/"):
            return await self.env.ASSETS.fetch(
                Request("https://placeholder/player.html", method="GET")
            )

        # Static assets
        return await self.env.ASSETS.fetch(request)
