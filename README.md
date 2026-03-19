# Nexus

A lightweight, self-hosted voice chat application with a Matrix-inspired terminal aesthetic.

## Getting Started

1. Install dependencies:
   ```bash
   bun i
   ```

2. Run the development server:
   ```bash
   bun dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

### Docker

Build the image:

```bash
docker build -t nexus .
```

Run the container:

```bash
docker run --rm -p 3000:3000 \
  -e NEXUS_PASSWORD=potato \
  nexus
```

The container listens on `0.0.0.0:${PORT:-3000}` and exposes `/api/health` for health checks.

### Docker Compose

Start the app:

```bash
docker compose up --build
```

Compose reads local environment variables and wires the service to port `3000` by default.

### Railway

`railway.toml` is included and tells Railway to build from the root `Dockerfile` and use `/api/health` as the deployment health check.

## Features

### Matrix Rain Animation
- Full-screen canvas animation with falling characters inspired by The Matrix
- Serves as a dramatic intro sequence on first visit
- Persists as a subtle background effect throughout the application

### Terminal-Style Authentication
- Minimalist login modal with retro terminal aesthetics
- Visual feedback on authentication errors (screen shake and red glow effect)
- Username persistence via localStorage for returning users

### Voice Room Interface
- Animated "lava-lamp" style user avatars with organic blob shapes
- Real-time speaking indicators driven by live microphone activity
- Audio controls for muting/unmuting microphone
- Bun-native room session API and WebSocket signaling
- Browser-to-browser audio transport over WebRTC
- Clean disconnect flow to return to the intro screen

### Design Details
- Dark terminal aesthetic with Matrix green (#00ff41) as the primary accent
- Scanline overlay effect for authentic CRT monitor feel
- Monospace typography throughout (Geist Mono)
- Fully responsive design optimized for both desktop and mobile
- Custom scrollbar styling to match the theme

## Tech Stack

- **Runtime**: Bun
- **Framework**: React
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Animations**: CSS animations + Canvas API
- **Language**: TypeScript

## Realtime Architecture

- **Sessions/Auth**: Bun HTTP routes at `/api/session`
- **Presence/Signaling**: Bun native WebSockets at `/api/ws`
- **Audio**: WebRTC peer mesh between connected browsers

WebSockets handle room state and WebRTC offer/answer/ICE exchange. Audio does not flow through the Bun server.

## Environment

Optional environment variables:

- `PORT`: HTTP port, defaults to `3000`
- `HOST`: HTTP bind address, defaults to `0.0.0.0`
- `NEXUS_PASSWORD`: plaintext password used on startup if `NEXUS_PASSWORD_HASH` is not set
- `NEXUS_PASSWORD_HASH`: pre-hashed password verified with `Bun.password.verify()`
- `NEXUS_ROOM_ID`: room identifier, defaults to `main`
- `NEXUS_STUN_URLS`: comma-separated STUN URLs
- `NEXUS_TURN_URLS`: comma-separated TURN URLs
- `NEXUS_TURN_USERNAME`: TURN username
- `NEXUS_TURN_CREDENTIAL`: TURN credential

If `NEXUS_PASSWORD_HASH` is empty, malformed, or uses an unsupported algorithm, the server falls back to `NEXUS_PASSWORD`.

For production reliability across restrictive NATs, configure TURN credentials. STUN-only setups are usually enough for local development but not enough for every real network.

## License

MIT
