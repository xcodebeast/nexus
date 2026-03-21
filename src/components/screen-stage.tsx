import { useEffect, useRef } from "react";

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
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
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
      data-testid="screen-stage"
      className="w-full max-w-5xl mb-8 rounded-xl border border-primary/30 bg-black/40 p-4 shadow-[0_0_30px_rgba(0,255,65,0.08)] backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-sm font-mono text-primary/80">{description}</p>
        </div>
        {presenterName && (
          <span className="rounded-full border border-primary/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.25em] text-primary">
            LIVE
          </span>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-primary/20 bg-muted/30 aspect-video">
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
