import { Button } from "@/components/ui/button";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { VoiceAvatar } from "./voice-avatar";
import { ScreenStage } from "./screen-stage";
import { appConfig } from "@/lib/config";
import {
  GithubIcon,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  PowerIcon,
} from "lucide-react";

interface VoiceRoomProps {
  currentUser: string;
  onDisconnect: () => Promise<void> | void;
}

function getStatusLabel(connectionState: string) {
  if (connectionState === "requesting-media") return "Requesting microphone access";
  if (connectionState === "connecting") return "Establishing realtime channel";
  if (connectionState === "disconnected") return "Realtime channel offline";

  return "Voice channel active";
}

export function VoiceRoom({ currentUser, onDisconnect }: VoiceRoomProps) {
  const {
    users,
    selfUserId,
    isMuted,
    connectionState,
    error,
    activeScreenShareUserId,
    activeScreenStream,
    screenShareStatus,
    screenShareError,
    screenShareNotice,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    disconnect,
  } = useVoiceRoom();

  const handleDisconnect = async () => {
    await disconnect();
    await onDisconnect();
  };

  const muteDisabled = connectionState === "disconnected";
  const activePresenter =
    users.find((user) => user.id === activeScreenShareUserId) ?? null;
  const activePresenterName = activePresenter?.username ?? null;
  const isSelfPresenting =
    Boolean(selfUserId) && activeScreenShareUserId === selfUserId;
  const screenShareDisabled =
    connectionState !== "connected" ||
    !selfUserId ||
    screenShareStatus === "unsupported" ||
    screenShareStatus === "requesting" ||
    screenShareStatus === "starting" ||
    screenShareStatus === "stopping";
  const screenShareButtonLabel = isSelfPresenting
    ? "Stop Sharing"
    : activeScreenShareUserId
      ? "Take Over Share"
      : "Share Screen";
  const presenterStatus = activePresenterName
    ? `Presenter: ${activePresenterName}${isSelfPresenting ? " (YOU)" : ""}`
    : "";
  const screenShareSupportCopy =
    screenShareStatus === "unsupported"
      ? "Screen sharing is available in desktop Chromium browsers."
      : null;
  const handleScreenShareAction = async () => {
    if (isSelfPresenting) {
      stopScreenShare();
      return;
    }

    await startScreenShare();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
      <div className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold text-primary tracking-wider mb-2">
          {appConfig.appName} 
        </h1>
        <p className="text-xs sm:text-sm font-mono text-muted-foreground">
          {getStatusLabel(connectionState)} - {users.length} connected
        </p>
        <p className="mt-2 text-[11px] sm:text-xs font-mono uppercase tracking-[0.25em] text-primary/75">
          {presenterStatus}
        </p>
        {error && (
          <p className="mt-3 text-xs font-mono text-destructive">{error}</p>
        )}
        {screenShareSupportCopy && (
          <p className="mt-2 text-xs font-mono text-muted-foreground">
            {screenShareSupportCopy}
          </p>
        )}
        {screenShareError && (
          <p className="mt-2 text-xs font-mono text-destructive">
            {screenShareError}
          </p>
        )}
        {screenShareNotice && (
          <p className="mt-2 text-xs font-mono text-primary/75">
            {screenShareNotice}
          </p>
        )}
      </div>

      {activeScreenShareUserId && (
        <ScreenStage
          stream={activeScreenStream}
          presenterName={activePresenterName}
          isLocalPresenter={isSelfPresenting}
        />
      )}

      <div className="flex flex-wrap justify-center gap-6 sm:gap-8 max-w-md mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
        {users.map((user) => (
          <VoiceAvatar
            key={user.id}
            username={
              user.id === selfUserId ? `${currentUser} (YOU)` : user.username
            }
            isSpeaking={user.isSpeaking}
            isMuted={user.isMuted}
          />
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
        <Button
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          disabled={muteDisabled}
          variant={isMuted ? "destructive" : "outline"}
          className={`
            font-mono uppercase tracking-wider px-6 transition-all duration-300
            ${
              isMuted
                ? "bg-destructive/20 border-destructive text-destructive hover:bg-destructive/30"
                : "border-primary/50 text-primary hover:bg-primary/10 hover:border-primary"
            }
          `}
        >
          {isMuted ? <MicOffIcon/> : <MicIcon/>}
        </Button>

        <Button
          onClick={() => void handleScreenShareAction()}
          aria-label={screenShareButtonLabel}
          disabled={screenShareDisabled}
          variant={isSelfPresenting ? "destructive" : "outline"}
          className={`
            font-mono uppercase tracking-wider px-6 transition-all duration-300
            ${
              isSelfPresenting
                ? "bg-destructive/20 border-destructive text-destructive hover:bg-destructive/30"
                : "border-primary/50 text-primary hover:bg-primary/10 hover:border-primary"
            }
          `}
        >
          <MonitorIcon />
        </Button>

        <Button
          onClick={() => void handleDisconnect()}
          aria-label="Disconnect"
          variant="outline"
          className="font-mono uppercase tracking-wider px-6 border-destructive/50 text-destructive hover:bg-destructive/10 hover:border-destructive transition-all duration-300"
        >
          <PowerIcon/>
        </Button>
      </div>

      <div className="absolute bottom-4 text-center animate-in fade-in duration-1000 delay-500">
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <a target="_blank" className="inline-flex items-center gap-2 text-muted-foreground/40 hover:text-foreground" href={appConfig.githubUrl} aria-label="GitHub Repository" rel="noopener noreferrer">
              <GithubIcon/>
              {appConfig.appName}
              {" "}{appConfig.version}
            </a>
            |
            <a target="_blank" className="text-muted-foreground/40 hover:text-foreground" href={appConfig.creatorWebsite}>{appConfig.creatorName}</a>
          </div>
      </div>
    </div>
  );
}
