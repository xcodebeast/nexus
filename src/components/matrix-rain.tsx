"use client";

import { useEffect, useRef, useState } from "react";
import { appConfig } from "@/lib/config";

interface MatrixRainProps {
  introMode?: boolean;
  introDurationMs?: number;
  onIntroComplete?: () => void;
}

const INTRO_OPACITY = 1;
const INTRO_HOLD_RATIO = 0.7;

export function MatrixRain({
  introMode = false,
  introDurationMs = appConfig.introAnimation.firstVisitDurationMs,
  onIntroComplete,
}: MatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(
    introMode ? INTRO_OPACITY : appConfig.introAnimation.idleOpacity,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    setOpacity(introMode ? INTRO_OPACITY : appConfig.introAnimation.idleOpacity);

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
    let introTimer: number | undefined;
    let fadeAnimationFrame: number | undefined;

    if (introMode && onIntroComplete) {
      const holdDurationMs = Math.max(
        0,
        Math.round(introDurationMs * INTRO_HOLD_RATIO),
      );
      const fadeDurationMs = Math.max(introDurationMs - holdDurationMs, 1);

      introTimer = window.setTimeout(() => {
        const fadeStartTime = performance.now();

        const animateFade = (timestamp: number) => {
          const progress = Math.min(
            (timestamp - fadeStartTime) / fadeDurationMs,
            1,
          );
          const nextOpacity =
            INTRO_OPACITY -
            progress *
              (INTRO_OPACITY - appConfig.introAnimation.idleOpacity);

          setOpacity(nextOpacity);

          if (progress < 1) {
            fadeAnimationFrame = window.requestAnimationFrame(animateFade);
            return;
          }

          setOpacity(appConfig.introAnimation.idleOpacity);
          onIntroComplete();
        };

        fadeAnimationFrame = window.requestAnimationFrame(animateFade);
      }, holdDurationMs);
    }

    return () => {
      clearInterval(interval);
      if (introTimer !== undefined) {
        window.clearTimeout(introTimer);
      }
      if (fadeAnimationFrame !== undefined) {
        window.cancelAnimationFrame(fadeAnimationFrame);
      }
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [introDurationMs, introMode, onIntroComplete]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity }}
    />
  );
}
