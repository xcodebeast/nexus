import { useEffect, useRef } from "react";

interface VoiceAvatarProps {
  username: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isAfk: boolean;
}

export function VoiceAvatar({
  username,
  isSpeaking,
  isMuted,
  isAfk,
}: VoiceAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const blobsRef = useRef<
    Array<{ x: number; y: number; vx: number; vy: number; radius: number }>
  >([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 80;
    canvas.width = size;
    canvas.height = size;

    if (blobsRef.current.length === 0) {
      for (let i = 0; i < 4; i += 1) {
        blobsRef.current.push({
          x: Math.random() * size,
          y: Math.random() * size,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: 15 + Math.random() * 10,
        });
      }
    }

    const animate = () => {
      ctx.clearRect(0, 0, size, size);

      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, size, size);

      const blobs = blobsRef.current;
      const speed = isSpeaking && !isAfk ? 2 : 0.5;

      blobs.forEach((blob) => {
        blob.x += blob.vx * speed;
        blob.y += blob.vy * speed;

        if (blob.x < blob.radius || blob.x > size - blob.radius) blob.vx *= -1;
        if (blob.y < blob.radius || blob.y > size - blob.radius) blob.vy *= -1;

        blob.x = Math.max(blob.radius, Math.min(size - blob.radius, blob.x));
        blob.y = Math.max(blob.radius, Math.min(size - blob.radius, blob.y));
      });

      const imageData = ctx.createImageData(size, size);
      const data = imageData.data;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          let sum = 0;

          blobs.forEach((blob) => {
            const dx = x - blob.x;
            const dy = y - blob.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            sum += (blob.radius * blob.radius) / (dist * dist + 1);
          });

          const index = (y * size + x) * 4;
          if (sum > 1) {
            const intensity = Math.min(sum / 3, 1);
            data[index] = Math.floor(intensity * 57);
            data[index + 1] = Math.floor(200 + intensity * 55);
            data[index + 2] = Math.floor(intensity * 65);
            data[index + 3] = Math.floor(intensity * 255);
          } else {
            data[index + 3] = 0;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      ctx.restore();

      if (isSpeaking && !isAfk) {
        ctx.shadowColor = "#00ff41";
        ctx.shadowBlur = 20;
        ctx.strokeStyle = "#00ff41";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isAfk, isSpeaking]);

  const speakingGlowClass =
    isSpeaking && !isAfk
      ? "ring-2 ring-primary shadow-[0_0_20px_rgba(0,255,65,0.5)]"
      : isAfk
        ? "ring-2 ring-amber-400/80 shadow-[0_0_18px_rgba(251,191,36,0.25)]"
        : "ring-1 ring-primary/30";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={`
            rounded-full transition-all duration-300
            ${speakingGlowClass}
            ${isMuted || isAfk ? "opacity-55" : ""}
          `}
          style={{ width: 80, height: 80 }}
        />
        {isAfk ? (
          <span
            role="status"
            aria-label={`${username} is AFK`}
            data-testid="voice-avatar-afk"
            className="absolute inset-x-2 bottom-2 px-2 py-1 text-center text-[10px] font-mono uppercase tracking-[0.25em] text-amber-300"
          >
            AFK
          </span>
        ) : null}
        {!isAfk && isMuted && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/50">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-destructive"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
        )}
      </div>
      <span className="max-w-[80px] truncate text-xs font-mono text-primary/80">
        {username}
      </span>
    </div>
  );
}
