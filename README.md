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
- Expanded screen-share stage with optional browser fullscreen
- Optional cameras with inline participant video and a mirrored local preview
- Temporary collaborative whiteboard with pen, colors, stroke widths, eraser, undo-own-stroke, and shared clear
- Distinct room notification sounds when participants go AFK and return
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
- **Camera**: A video transceiver bundled into each existing audio connection
- **Screen Share**: Server-authoritative single presenter over a separate WebRTC video mesh channel
- **Whiteboard**: Server-ordered drawing commands over an opt-in WebSocket topic

WebSockets handle room state, presenter ownership, and WebRTC offer/answer/ICE exchange. Audio, camera video, and screen video do not flow through the Bun server (TURN may relay media when a direct connection is unavailable).

Only one user can present at a time. If another user starts screen sharing, the current presenter is stopped automatically and the room switches to the new presenter.

Microphone access requires a secure context in the browser. Use HTTPS in deployed environments, or `localhost` during development.
When the browser supports AudioWorklet, Nexus denoises the outgoing mic stream locally before it is sent to peers. If RNNoise cannot start or the browser lacks support, Nexus falls back to browser DSP/pass-through without breaking the call.
Screen sharing is optimized for desktop Chromium browsers in the current small-room peer-mesh architecture.
The screen stage expands with the viewport; its fullscreen control changes only the local layout and does not restart capture or increase stream resolution or frame rate.

### Shared whiteboard

Open the board with its room control or **Ctrl+B**. Everyone can draw with a mouse, pen, or touch. Pen colors and stroke widths apply to new strokes. The eraser can remove ink from any participant; **Undo mine** reverses only your own latest stroke, including erasing. Clearing the entire board asks for confirmation and affects everyone.

The board is temporary: its history stays available to late joiners and reconnecting participants while the room remains occupied, and clears when the last participant leaves or the service restarts. Each person chooses whether to view it; opening the board does not interrupt another person's screen share or camera. AFK participants can view the board but must return to draw.

Nexus sends integer point batches at most every 50 ms while drawing, plus stroke start/end messages. It sends no canvas images, video, idle animation frames, or cursor broadcasts. Closed boards unsubscribe from updates and fetch the current snapshot when reopened. The server validates ownership, coordinates, colors, widths, and batch size, rate-limits each writer, and retains at most 512 strokes / 16,384 points (2,048 per stroke). A full board asks users to undo or clear instead of silently deleting drawings.

Production builds split the whiteboard UI into a chunk fetched only on first open. The production server builds frontend assets once in memory at startup with `Bun.build`; development keeps Bun's HTML/HMR flow. A failed whiteboard download leaves voice controls and audio running.

Run the focused server state tests with `bun run test:unit`. End-to-end coverage runs against production mode through `bun run test:e2e`.

### Lightweight cameras

Use the camera control or **Ctrl+E** to turn your camera on or off. Cameras start off, and Nexus requests access only when you turn yours on. Camera tiles replace the animated avatars while video is enabled; microphone muting does not turn off video. AFK, disconnecting, or losing the signaling connection stops capture. Returning to the room leaves the camera off until you enable it again.

- Capture is limited to **640×360 at 15 fps**, with a motion content hint and native browser codec selection. Nexus adds no video library, background effects, canvas processing, or simulcast encoders.
- Camera video shares the audio connection's ICE/DTLS transport. A reserved video transceiver allows camera toggles through `replaceTrack()` without another peer connection or SDP renegotiation. Turning it off stops the device and detaches the sender track instead of sending black frames.
- Each sender is limited to **300 kbps** of camera payload. A **600 kbps total payload budget per camera user** is divided among non-AFK viewers. At four or more viewers, outgoing resolution is also halved. The browser can reduce quality further under congestion; transport headers, retransmissions, and other media add to these limits.
- Bandwidth limits are updated when viewers join, leave, or go AFK. Video has low sender priority, and screen sharing keeps its own independent stream.

The mesh still needs a separate encoder and upload per viewer. The budget bounds the requested payload rate, but CPU use grows with room size. Nexus remains intended for small rooms; larger video rooms would need an SFU to forward a single upload. These defaults favor small conversational tiles over HD video.

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
