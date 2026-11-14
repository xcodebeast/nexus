import { useEffect, useRef } from "react";
import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStageFullscreen } from "@/hooks/use-stage-fullscreen";
import { cn } from "@/lib/utils";

interface ScreenStageProps {
  stream: MediaStream | null;
  presenterName: string | null;
  isLocalPresenter: boolean;
}

export function ScreenStage({
  stream,
  presenterName,
  isLocalPresenter,
}: ScreenStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fullscreen = useStageFullscreen();

  useEffect(() => {
    fullscreen.stageRef.current?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    if (stream) {
      void video.play().catch(() => {});
    }

    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  const title = presenterName
    ? `Screen Share: ${presenterName}${isLocalPresenter ? " (YOU)" : ""}`
    : "Screen Share: Idle";

  const description = presenterName
    ? isLocalPresenter
      ? "Your screen is live in the room."
      : `${presenterName} is sharing their screen.`
    : "No one is sharing a screen right now.";

  return (
    <section
      ref={fullscreen.stageRef}
      data-testid="screen-stage"
      className={cn(
        "mb-8 flex w-full scroll-mt-20 flex-col rounded-xl border border-primary/30 bg-black/40 p-3 shadow-[0_0_30px_rgba(0,255,65,0.08)] backdrop-blur-sm sm:p-4",
        fullscreen.isFullscreen &&
          "m-0 h-dvh rounded-none border-0 bg-background",
      )}
    >
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-sm font-mono text-primary/80">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {presenterName && (
            <span className="rounded-full border border-primary/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.25em] text-primary">
              LIVE
            </span>
          )}
          {fullscreen.isSupported && (
            <Button
              aria-label={
                fullscreen.isFullscreen
                  ? "Exit screen share fullscreen"
                  : "Enter screen share fullscreen"
              }
              onClick={() => void fullscreen.toggle()}
              disabled={fullscreen.isPending}
              variant="outline"
              size="icon"
              className="border-primary/40 text-primary"
            >
              {fullscreen.isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            </Button>
          )}
        </div>
      </div>

      {fullscreen.error && (
        <p role="alert" className="mb-3 text-xs font-mono text-destructive">
          {fullscreen.error}
        </p>
      )}
      <div
        className={cn(
          "relative min-h-0 overflow-hidden rounded-lg border border-primary/20 bg-muted/30",
          fullscreen.isFullscreen && "flex-1",
        )}
        style={
          fullscreen.isFullscreen
            ? undefined
            : { height: "min(82dvh, calc((100vw - 2rem) * 0.5625))" }
        }
      >
        {stream ? (
          <video
            ref={videoRef}
            data-testid="screen-share-video"
            aria-label={
              presenterName
                ? `${presenterName} screen share`
                : "Active screen share"
            }
            className="h-full w-full object-contain bg-black"
            autoPlay
            muted
            playsInline
          />
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center px-6 text-center">
            <p
              data-testid="screen-stage-empty"
              className="max-w-md text-sm font-mono text-muted-foreground"
            >
              {presenterName
                ? "Waiting for the screen share stream to connect."
                : "Start sharing to present something to the room."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
