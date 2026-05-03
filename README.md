# Balloon Water Race

A carnival water gun game built with **Python Workers** and **Durable Objects** on Cloudflare. Perfect for conference booths!

## How It Works

- **Big Screen**: Displays 5 clowns with water balloons. Project this for the audience.
- **Phone**: Players scan the QR code on the big screen, enter their name, and use their camera to aim at a clown's mouth. When the neon ring is centered in the crosshair, they hold **SHOOT**.
- **Scoring**: 10 points per second of accurate shooting (1 point per 100ms tick). The balloon fills up. When it pops, the top 3 players are shown on screen!

## Architecture

- **`Default` (WorkerEntrypoint)**: Proxies WebSocket upgrades to the Durable Object. All other requests are served from static `assets/` via the `ASSETS` binding.
- **`BalloonGame` (DurableObject)**: Manages shared game state, player scores, WebSocket connections (with Hibernation for cost efficiency), and balloon pop resets via the Alarms API.
- **Aiming**: Uses real-time camera color detection in the browser. Each clown mouth has a distinct neon color ring. The phone samples the center pixel and matches it.

## Quick Start

### Prerequisites

- [uv](https://docs.astral.sh/uv/)
- [Node.js](https://nodejs.org/)

### 1. Install dependencies

```bash
uv sync
npm install
```

### 2. Run Locally

```bash
npm run dev
```

Or directly with pywrangler:

```bash
uv run pywrangler dev
```

- Open `http://localhost:8787` on the **big screen**.
- Open `http://localhost:8787/player.html` on your **phone**, or scan the QR code shown on the big screen.

### 4. Deploy

```bash
npm run deploy
```

Or directly:

```bash
uv run pywrangler deploy
```

## Game Details

- **5 Shared Clowns**: All players compete on the same balloons. More shooters = faster pops!
- **Balloon Capacity**: 300 fill units (about 30 seconds for a single player).
- **Reset**: Balloons automatically reinflate 5 seconds after popping.
- **Leaderboard**: Top 3 scores displayed on every pop.

## Tips for PyCon

- Make sure the big screen has good brightness so the neon colors are visible to phone cameras.
- The colored rings around clown mouths are the targets. In bright light, the color detection works best within ~3 meters.
- Players should use their **rear camera** (facing the screen) for best results.
