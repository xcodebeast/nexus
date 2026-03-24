# Nexus Design System Guide

A comprehensive styling reference for AI agents to replicate the Matrix-themed aesthetic.

---

## Color Palette (5 Colors Only)

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#0a0a0a` | Page background, canvas clear color |
| `--primary` / `--foreground` | `#00ff41` | Primary text, borders, glows, icons |
| `--muted-foreground` | `#00cc33` | Secondary text, dimmed elements |
| `--secondary` / `--matrix-dim` | `#003b00` | Subtle backgrounds, inactive states |
| `--destructive` | `#ff0040` | Errors, disconnect, muted state |

### Color Rules
- All text uses `text-primary` (#00ff41) or `text-muted-foreground` (#00cc33)
- Never use white text except for brief flashes in animations
- Error states use `--destructive` (#ff0040) sparingly
- Backgrounds are near-black variants: `#0a0a0a`, `#0d0d0d`, `#1a1a1a`

---

## Typography

### Font Stack
- **Primary font**: `font-mono` (Geist Mono)
- **No sans-serif fonts** - everything uses monospace

### Text Styles
```
Headings:    font-mono font-bold tracking-wider or tracking-[0.3em]
Body:        font-mono text-sm or text-xs
Labels:      font-mono text-xs uppercase tracking-wider
Terminal:    Prefix with ">" character (e.g., "> Connect")
```

### Sizing Scale
- Hero title: `text-4xl sm:text-6xl`
- Section title: `text-2xl sm:text-3xl`
- Body: `text-sm`
- Labels/hints: `text-xs`
- Footer: `text-[10px]`

---

## Glow Effects

### Box Shadows (Critical for Matrix feel)
```css
/* Standard glow */
shadow-[0_0_20px_rgba(0,255,65,0.3)]

/* Hover/active glow - increase spread */
shadow-[0_0_40px_rgba(0,255,65,0.6)]

/* Text glow via drop-shadow */
drop-shadow-[0_0_15px_rgba(0,255,65,0.6)]
drop-shadow-[0_0_20px_rgba(0,255,65,0.8)]  /* More intense */

/* Error glow */
shadow-[0_0_30px_rgba(255,0,64,0.3)]
```

### Ring Effects
```
Active/speaking:  ring-2 ring-primary
Inactive:         ring-1 ring-primary/30
Focus:            focus:ring-primary/20
```

---

## Animation Patterns

### Entrance Animations (use tw-animate-css)
```
animate-in fade-in slide-in-from-top-4 duration-700
animate-in fade-in slide-in-from-bottom-4 duration-700
animate-in fade-in zoom-in-95 duration-700
```

### Staggered Delays
```
First element:   delay-0 or no delay
Second element:  delay-150
Third element:   delay-300
Footer:          delay-500
```

### State Animations
```
Pulse:     animate-pulse (for loading/active states)
Shake:     animate-shake (custom, for errors - 0.5s)
```

### Transition Defaults
```
transition-all duration-300   /* Standard */
transition-all duration-500   /* Emphasis */
transition-all duration-700   /* Entrance */
```

### Custom Shake Keyframes
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}
```

---

## Component Patterns

### Buttons

**Primary CTA (Outline style)**
```tsx
<Button className="
  px-8 py-6 text-lg font-mono uppercase tracking-widest
  bg-transparent border-2 border-primary text-primary
  hover:bg-primary hover:text-primary-foreground
  transition-all duration-500
  shadow-[0_0_20px_rgba(0,255,65,0.3)]
  hover:shadow-[0_0_40px_rgba(0,255,65,0.6)]
">
  {">"} Connect
</Button>
```

**Secondary/Control Button**
```tsx
<Button className="
  font-mono uppercase tracking-wider px-6
  border-primary/50 text-primary
  hover:bg-primary/10 hover:border-primary
  transition-all duration-300
">
```

**Destructive Button**
```tsx
<Button className="
  font-mono uppercase tracking-wider px-6
  border-destructive/50 text-destructive
  hover:bg-destructive/10 hover:border-destructive
  transition-all duration-300
">
```

### Inputs
```tsx
<Input className="
  bg-input border-primary/30 text-primary font-mono
  placeholder:text-muted-foreground/50
  focus:border-primary focus:ring-primary/20
"/>
```

**Error state input:**
```tsx
className={`... ${error ? "border-destructive bg-destructive/10" : ""}`}
```

### Cards/Modals
```tsx
<DialogContent className="
  bg-card/95 border-primary/30 backdrop-blur-md
  shadow-[0_0_30px_rgba(0,255,65,0.2)]
">
```

### Labels
```tsx
<Label className="text-primary/80 font-mono text-xs uppercase tracking-wider">
```

---

## Layout Rules

### Centering (Primary pattern)
```tsx
<div className="flex items-center justify-center min-h-screen">
```

### Grid for Avatars
```tsx
<div className="flex flex-wrap justify-center gap-6 sm:gap-8 max-w-md">
```

### Spacing Scale
- Small gaps: `gap-2`, `gap-4`
- Medium gaps: `gap-6`
- Large gaps: `gap-8`
- Section margins: `mb-8`, `mb-12`

### Z-Index Layers
```
z-0:   Background canvas (Matrix rain)
z-10:  Main content
z-20:  Overlay effects (scanlines)
z-50:  Modals (handled by Dialog)
```

---

## Special Effects

### Matrix Rain Canvas
- Font size: 14px monospace
- Characters: Katakana + Latin + Numbers + Symbols
- Trail effect: `rgba(10, 10, 10, 0.05)` fill each frame
- Color variation: 95%+ white, 80%+ bright green (#39ff14), else standard (#00ff41)
- Drop reset: when y > canvas.height and random > 0.975
- Frame rate: 33ms interval (~30fps)

### Lava Lamp Avatar (Metaballs)
- Canvas size: 80x80px
- Blob count: 4 blobs
- Blob radius: 15-25px
- Speed: 0.5 normal, 2.0 when speaking
- Metaball threshold: sum > 1 for visibility
- Color: RGB(57 * intensity, 200 + 55 * intensity, 65 * intensity)

### Scanline Overlay
```tsx
<div 
  className="fixed inset-0 pointer-events-none z-20 opacity-[0.03]"
  style={{
    background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 65, 0.1) 2px, rgba(0, 255, 65, 0.1) 4px)",
  }}
/>
```

---

## Error State Pattern

When authentication fails:
1. Add `animate-shake` class to container
2. Add `border-destructive` to container
3. Add `shadow-[0_0_30px_rgba(255,0,64,0.3)]` glow
4. Apply `filter: blur(1px)` to modal
5. Show error text with `text-destructive text-xs font-mono animate-pulse`
6. Remove shake after 500ms
7. Remove error styling after 1500ms

---

## Responsive Breakpoints

```
Mobile first - base styles
sm: (640px+) - Larger text, increased spacing
```

Key responsive adjustments:
- Title: `text-4xl sm:text-6xl`
- Gaps: `gap-6 sm:gap-8`
- Section titles: `text-2xl sm:text-3xl`

---

## Opacity Scale

```
Full:        opacity-100 or no class
Dimmed:      opacity-50 (muted users)
Subtle:      /80, /60, /50, /40, /30 (borders, text variations)
Overlay:     opacity-[0.03] (scanlines)
Background:  opacity-[0.15] (matrix rain after intro)
```

---

## File Structure

```
components/
├── matrix-rain.tsx      # Canvas background effect
├── login-modal.tsx      # Authentication dialog
├── voice-avatar.tsx     # Animated user avatar (metaballs)
└── voice-room.tsx       # Main room with controls
app/
├── globals.css          # Theme tokens + custom animations
├── layout.tsx           # font-mono, bg-[#0a0a0a]
└── page.tsx             # State machine (intro → connect → room)
```

---

## Quick Reference Checklist

- [ ] All text uses `font-mono`
- [ ] Terminal commands prefixed with `">"`
- [ ] Buttons have `uppercase tracking-wider`
- [ ] Interactive elements have glow shadows
- [ ] Entrance animations use `animate-in` with staggered delays
- [ ] Error states use red (#ff0040) with shake + blur
- [ ] Speaking states have `ring-2` + increased glow
- [ ] Background is `#0a0a0a`, never pure black
- [ ] Scanline overlay is present with `opacity-[0.03]`
- [ ] All hover states increase glow intensity
