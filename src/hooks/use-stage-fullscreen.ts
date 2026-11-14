import { useEffect, useRef, useState } from "react";

export function useStageFullscreen() {
  const stageRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(
      Boolean(
        document.fullscreenEnabled && stageRef.current?.requestFullscreen,
      ),
    );
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
      setError(null);
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  async function toggle() {
    if (!stageRef.current || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      if (document.fullscreenElement === stageRef.current)
        await document.exitFullscreen();
      else await stageRef.current.requestFullscreen();
    } catch {
      setError(
        "Fullscreen is unavailable right now. You can keep using the expanded view.",
      );
    } finally {
      setIsPending(false);
    }
  }

  return { stageRef, isFullscreen, isSupported, isPending, error, toggle };
}
