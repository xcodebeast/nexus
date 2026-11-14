import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface CameraTileProps {
  stream: MediaStream | null;
  username: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
}

export function CameraTile({
  stream,
  username,
  isLocal,
  isSpeaking,
  isMuted,
}: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div
      className={cn(
        "relative aspect-video w-64 max-w-full overflow-hidden rounded-lg border bg-black",
        isSpeaking
          ? "border-primary shadow-[0_0_16px_rgba(0,255,65,0.3)]"
          : "border-primary/30",
      )}
    >
      <video
        ref={videoRef}
        aria-label={`${username} camera`}
        data-testid="camera-video"
        className={cn("h-full w-full object-cover", isLocal && "-scale-x-100")}
        autoPlay
        muted
        playsInline
      />
      {!stream && (
        <p className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground">
          Connecting camera…
        </p>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/70 px-3 py-2 text-xs font-mono text-primary/80">
        <span className="truncate">{username}</span>
        {isMuted && <span className="text-destructive">MUTED</span>}
      </div>
    </div>
  );
}
