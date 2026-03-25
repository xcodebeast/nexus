# Nexus

A fast, lightweight, minimal, self-hosted voice chat webapp with a Matrix-inspired aesthetic made for power users that are tired of using bloated proprietary software that trades with your personal data.

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
  -e NEXUS_PASSWORD=yourpassword \
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

### Terminal-Style Authentication
- Minimalist login modal with retro terminal aesthetics
- Visual feedback on authentication errors (screen shake and red glow effect)
- Username persistence via localStorage for returning users

### Voice Room Interface
- Animated "lava-lamp" style user avatars with organic blob shapes
- Real-time speaking indicators driven by live microphone activity
- Audio controls for muting/unmuting microphone
- Local RNNoise-based microphone denoising with automatic browser fallback
- Single-presenter screen sharing with automatic takeover when another user starts presenting
- Inline screen stage for local preview and remote viewing
- Bun-native room session API and WebSocket signaling
- Browser-to-browser audio transport over WebRTC
- Clean disconnect flow to return to the intro screen

### Progressive Web App Shell
- Installable desktop-first PWA with a standalone app manifest
- Cached application shell for repeat launches and offline reopen after one successful online visit
- Explicit offline messaging so the shell remains usable without implying voice, auth, or presence work offline

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
- **Screen Share**: Server-authoritative single presenter over a separate WebRTC video mesh channel

WebSockets handle room state, presenter ownership, and WebRTC offer/answer/ICE exchange. Audio and screen video do not flow through the Bun server.

Only one user can present at a time. If another user starts screen sharing, the current presenter is stopped automatically and the room switches to the new presenter.

Microphone access requires a secure context in the browser. Use HTTPS in deployed environments, or `localhost` during development.
When the browser supports AudioWorklet, Nexus denoises the outgoing mic stream locally before it is sent to peers. If RNNoise cannot start or the browser lacks support, Nexus falls back to browser DSP/pass-through without breaking the call.
Screen sharing is optimized for desktop Chromium browsers in the current small-room peer-mesh architecture.

## PWA Support

Nexus now supports a desktop-first Progressive Web App shell:

- Installability is optimized for Chromium-based desktop browsers
- The shell can reopen offline after it has been loaded successfully once online
- Voice rooms, authentication, websocket presence, and screen sharing remain online-only
- Service worker updates are applied on the next launch instead of interrupting an active session

For normal local development, the service worker stays disabled on `localhost` to avoid stale assets during HMR.
To test the PWA path locally, open:

```text
http://localhost:3000/?pwa=1
```

You can combine it with intro skipping for deterministic testing:

```text
http://localhost:3000/?skipIntro=1&pwa=1
```

Run the focused PWA end-to-end coverage with:

```bash
bun run test:e2e:pwa
```

Whenever a release changes cached shell assets, bump `appConfig.version` in `src/lib/config.ts` so the service worker cache version changes with it.

## Environment

Optional environment variables:

- `PORT`: HTTP port, defaults to `3000`
- `HOST`: HTTP bind address, defaults to `0.0.0.0`
- `NEXUS_PASSWORD`: plaintext password used on startup if `NEXUS_PASSWORD_HASH` is not set
- `NEXUS_PASSWORD_HASH`: pre-hashed password verified with `Bun.password.verify()`
- `NEXUS_ROOM_ID`: room identifier, defaults to `main`
- `NEXUS_STUN_URLS`: comma-separated STUN URLs
- `CLOUDFLARE_TURN_KEY_ID`: Cloudflare TURN key ID for generated credentials
- `CLOUDFLARE_TURN_API_TOKEN`: Cloudflare API token used server-side to mint TURN credentials
- `CLOUDFLARE_TURN_TTL_SECONDS`: optional TURN credential lifetime, defaults to `86400`
- `NEXUS_TURN_URLS`: comma-separated TURN URLs
- `NEXUS_TURN_USERNAME`: TURN username
- `NEXUS_TURN_CREDENTIAL`: TURN credential

If `NEXUS_PASSWORD_HASH` is empty, malformed, or uses an unsupported algorithm, the server falls back to `NEXUS_PASSWORD`.

For production reliability across restrictive NATs, configure TURN credentials. STUN-only setups are usually enough for local development but not enough for every real network. If Cloudflare TURN variables are set, the server generates short-lived ICE credentials automatically and those take precedence over the static `NEXUS_TURN_*` values.
If users can see each other's speaking glow but hear no audio, the signaling path is working and the media path is likely failing. The most common production cause is missing TURN relay configuration.

## License

MIT
