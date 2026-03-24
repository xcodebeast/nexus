import { Button } from "@/components/ui/button";
import {
  ConnectionState,
  ScreenShareStatus,
  useVoiceRoom,
} from "@/hooks/use-voice-room";
import { appConfig } from "@/lib/config";
import {
  GithubIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  PowerIcon,
} from "lucide-react";
import { ScreenStage } from "./screen-stage";
import { VoiceAvatar } from "./voice-avatar";

const statusToLabelMap = {
  [ConnectionState.RequestingMedia]: "Requesting microphone access",
  [ConnectionState.Connecting]: "Establishing realtime channel",
  [ConnectionState.Reconnecting]: "Restoring realtime channel",
  [ConnectionState.Disconnected]: "Realtime channel offline",
  [ConnectionState.Connected]: "Voice channel active",
} as const;

const getStatusLabel = (connectionState: ConnectionState) =>
  statusToLabelMap[connectionState] ?? "Voice channel active";

interface VoiceRoomProps {
  currentUser: string;
  onDisconnect: () => Promise<void> | void;
}

export function VoiceRoom({ currentUser, onDisconnect }: VoiceRoomProps) {
  const {
    users,
    selfUserId,
    isMuted,
    isAfk,
    connectionState,
    error,
    activeScreenShareUserId,
    activeScreenStream,
    screenShareStatus,
    screenShareError,
    screenShareNotice,
    toggleMute,
    toggleAfk,
    startScreenShare,
    stopScreenShare,
    disconnect,
  } = useVoiceRoom();

  const handleDisconnect = async () => {
    disconnect();
    await onDisconnect();
  };

  const muteDisabled =
    connectionState === ConnectionState.Disconnected || isAfk;
  const afkDisabled = connectionState === ConnectionState.Disconnected;
  const activePresenter =
    users.find((user) => user.id === activeScreenShareUserId) ?? null;
  const activePresenterName = activePresenter?.username ?? null;
  const isSelfPresenting =
    Boolean(selfUserId) && activeScreenShareUserId === selfUserId;
  const screenShareDisabled =
    isAfk ||
    connectionState !== ConnectionState.Connected ||
    !selfUserId ||
    screenShareStatus === ScreenShareStatus.Unsupported ||
    screenShareStatus === ScreenShareStatus.Requesting ||
    screenShareStatus === ScreenShareStatus.Starting ||
    screenShareStatus === ScreenShareStatus.Stopping;
  const presenterStatus = activePresenterName
    ? `Presenter: ${activePresenterName}${isSelfPresenting ? " (YOU)" : ""}`
    : "";
  const screenShareSupportCopy =
    screenShareStatus === ScreenShareStatus.Unsupported
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
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="mb-8 text-center animate-in fade-in slide-in-from-top-4 duration-700">
        <h1 className="mb-2 text-2xl font-mono font-bold tracking-wider text-primary sm:text-3xl">
          {appConfig.appName}
        </h1>
        <p className="text-xs font-mono text-muted-foreground sm:text-sm">
          {getStatusLabel(connectionState)} - {users.length} connected
        </p>
        <p className="mt-2 text-[11px] font-mono uppercase tracking-[0.25em] text-primary/75 sm:text-xs">
          {presenterStatus}
        </p>
        {isAfk && (
          <p className="mt-2 text-xs font-mono uppercase tracking-[0.2em] text-amber-300">
            AFK: mic and room audio paused.
          </p>
        )}
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

      <div className="mb-12 flex max-w-md flex-wrap justify-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 sm:gap-8">
        {users.map((user) => (
          <VoiceAvatar
            key={user.id}
            username={
              user.id === selfUserId ? `${currentUser} (YOU)` : user.username
            }
            isSpeaking={user.isSpeaking}
            isMuted={user.isMuted}
            isAfk={user.isAfk}
          />
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
        <ToggleMuteButton
          onToggleMute={toggleMute}
          disabled={muteDisabled}
          isMuted={isMuted}
        />
        <ToggleAfkButton
          onToggleAfk={toggleAfk}
          disabled={afkDisabled}
          isAfk={isAfk}
        />
        <ShareScreenButton
          onShareScreen={handleScreenShareAction}
          disabled={screenShareDisabled}
          isSelfPresenting={isSelfPresenting}
          activeScreenShareUserId={activeScreenShareUserId}
        />
        <DisconnectButton onDisconnect={handleDisconnect} />
      </div>

      <Footer />
    </div>
  );
}

type ToggleMuteButtonProps = {
  onToggleMute: () => void;
  disabled: boolean;
  isMuted: boolean;
};

const ToggleMuteButton = ({
  onToggleMute,
  disabled,
  isMuted,
}: ToggleMuteButtonProps) => {
  const muteButtonLabel = isMuted ? "Unmute microphone" : "Mute microphone";

  return (
    <Button
      onClick={onToggleMute}
      aria-label={muteButtonLabel}
      disabled={disabled}
      variant={isMuted ? "destructive" : "outline"}
      className={`
        px-6 font-mono uppercase tracking-wider transition-all duration-300
        ${
          isMuted
            ? "border-destructive bg-destructive/20 text-destructive hover:bg-destructive/30"
            : "border-primary/50 text-primary hover:border-primary hover:bg-primary/10"
        }
      `}
    >
      {isMuted ? <MicOffIcon /> : <MicIcon />}
    </Button>
  );
};

type ToggleAfkButtonProps = {
  onToggleAfk: () => void;
  disabled: boolean;
  isAfk: boolean;
};

const ToggleAfkButton = ({
  onToggleAfk,
  disabled,
  isAfk,
}: ToggleAfkButtonProps) => {
  const afkButtonLabel = isAfk ? "Return from AFK" : "Go AFK";

  return (
    <Button
      onClick={onToggleAfk}
      aria-label={afkButtonLabel}
      disabled={disabled}
      variant={isAfk ? "destructive" : "outline"}
      className={`
        px-6 font-mono uppercase tracking-wider transition-all duration-300
        ${
          isAfk
            ? "border-amber-400 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20"
            : "border-primary/50 text-primary hover:border-primary hover:bg-primary/10"
        }
      `}
    >
      {isAfk ? <HeadphoneOffIcon /> : <HeadphonesIcon />}
    </Button>
  );
};

type ShareScreenButtonProps = {
  onShareScreen: () => Promise<void> | void;
  disabled: boolean;
  isSelfPresenting: boolean;
  activeScreenShareUserId: string | null;
};

const ShareScreenButton = ({
  onShareScreen,
  disabled,
  isSelfPresenting,
  activeScreenShareUserId,
}: ShareScreenButtonProps) => {
  const screenShareButtonLabel = isSelfPresenting
    ? "Stop Sharing"
    : activeScreenShareUserId
      ? "Take Over Share"
      : "Share Screen";

  return (
    <Button
      onClick={() => void onShareScreen()}
      aria-label={screenShareButtonLabel}
      disabled={disabled}
      variant={isSelfPresenting ? "destructive" : "outline"}
      className={`
        px-6 font-mono uppercase tracking-wider transition-all duration-300
        ${
          isSelfPresenting
            ? "border-destructive bg-destructive/20 text-destructive hover:bg-destructive/30"
            : "border-primary/50 text-primary hover:border-primary hover:bg-primary/10"
        }
      `}
    >
      <MonitorIcon />
    </Button>
  );
};

type DisconnectButtonProps = {
  onDisconnect: () => Promise<void> | void;
};

const DisconnectButton = ({ onDisconnect }: DisconnectButtonProps) => (
  <Button
    onClick={() => void onDisconnect()}
    aria-label="Disconnect"
    variant="outline"
    className="border-destructive/50 px-6 font-mono uppercase tracking-wider text-destructive transition-all duration-300 hover:border-destructive hover:bg-destructive/10"
  >
    <PowerIcon />
  </Button>
);

const Footer = () => (
  <div className="absolute bottom-4 text-center animate-in fade-in duration-1000 delay-500">
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <a
        target="_blank"
        className="inline-flex items-center gap-2 text-muted-foreground/40 hover:text-foreground"
        href={appConfig.githubUrl}
        aria-label="GitHub Repository"
        rel="noopener noreferrer"
      >
        <GithubIcon />
        {appConfig.appName} {appConfig.version}
      </a>
      |
      <a
        target="_blank"
        className="text-muted-foreground/40 hover:text-foreground"
        href={appConfig.creatorWebsite}
      >
        {appConfig.creatorName}
      </a>
    </div>
  </div>
);
