import { useEffect, useRef } from "react";

interface VoiceAvatarProps {
  username: string;
  isSpeaking: boolean;
  isMuted: boolean;
}

export function VoiceAvatar({ username, isSpeaking, isMuted }: VoiceAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const blobsRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; radius: number }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 80;
    canvas.width = size;
    canvas.height = size;

    // Initialize blobs for lava lamp effect
    if (blobsRef.current.length === 0) {
      for (let i = 0; i < 4; i++) {
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

      // Create circular clipping mask
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      // Background
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, size, size);

      // Update and draw blobs
      const blobs = blobsRef.current;
      const speed = isSpeaking ? 2 : 0.5;

      blobs.forEach((blob) => {
        // Update position
        blob.x += blob.vx * speed;
        blob.y += blob.vy * speed;

        // Bounce off edges
        if (blob.x < blob.radius || blob.x > size - blob.radius) blob.vx *= -1;
        if (blob.y < blob.radius || blob.y > size - blob.radius) blob.vy *= -1;

        // Keep in bounds
        blob.x = Math.max(blob.radius, Math.min(size - blob.radius, blob.x));
        blob.y = Math.max(blob.radius, Math.min(size - blob.radius, blob.y));
      });

      // Draw metaballs effect
      const imageData = ctx.createImageData(size, size);
      const data = imageData.data;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
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
            // Matrix green gradient
            data[index] = Math.floor(intensity * 57); // R
            data[index + 1] = Math.floor(200 + intensity * 55); // G
            data[index + 2] = Math.floor(intensity * 65); // B
            data[index + 3] = Math.floor(intensity * 255); // A
          } else {
            data[index + 3] = 0;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      ctx.restore();

      // Glow effect when speaking
      if (isSpeaking) {
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
  }, [isSpeaking]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={`
            rounded-full transition-all duration-300
            ${isSpeaking ? "ring-2 ring-primary shadow-[0_0_20px_rgba(0,255,65,0.5)]" : "ring-1 ring-primary/30"}
            ${isMuted ? "opacity-50" : ""}
          `}
          style={{ width: 80, height: 80 }}
        />
        {isMuted && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-full">
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
      <span className="text-xs font-mono text-primary/80 max-w-[80px] truncate">
        {username}
      </span>
    </div>
  );
}
