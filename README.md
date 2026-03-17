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
- Real-time speaking indicators with pulsing glow effects
- Audio controls for muting/unmuting microphone
- Clean disconnect flow to return to the intro screen

### Design Details
- Dark terminal aesthetic with Matrix green (#00ff41) as the primary accent
- Scanline overlay effect for authentic CRT monitor feel
- Monospace typography throughout (Geist Mono)
- Fully responsive design optimized for both desktop and mobile
- Custom scrollbar styling to match the theme

## Tech Stack

- **Framework**: React
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Animations**: CSS animations + Canvas API
- **Language**: TypeScript

## License

MIT
