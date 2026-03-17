"use client";

import { useEffect, useRef, useState } from "react";

interface MatrixRainProps {
  introMode?: boolean;
  onIntroComplete?: () => void;
}

export function MatrixRain({ introMode = false, onIntroComplete }: MatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(introMode ? 1 : 0.15);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*";
    const charArray = chars.split("");
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(1);

    const draw = () => {
      ctx.fillStyle = "rgba(10, 10, 10, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#00ff41";
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = charArray[Math.floor(Math.random() * charArray.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Vary the brightness randomly
        const brightness = Math.random();
        if (brightness > 0.95) {
          ctx.fillStyle = "#ffffff";
        } else if (brightness > 0.8) {
          ctx.fillStyle = "#39ff14";
        } else {
          ctx.fillStyle = "#00ff41";
        }

        ctx.fillText(char, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 33);

    // Intro animation - fade out after delay
    if (introMode && onIntroComplete) {
      const introTimer = setTimeout(() => {
        // Smooth fade transition
        let currentOpacity = 1;
        const fadeInterval = setInterval(() => {
          currentOpacity -= 0.02;
          if (currentOpacity <= 0.15) {
            currentOpacity = 0.15;
            clearInterval(fadeInterval);
            onIntroComplete();
          }
          setOpacity(currentOpacity);
        }, 30);
      }, 3000);

      return () => {
        clearInterval(interval);
        clearTimeout(introTimer);
        window.removeEventListener("resize", resizeCanvas);
      };
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [introMode, onIntroComplete]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity }}
    />
  );
}
