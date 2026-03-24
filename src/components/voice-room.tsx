import { type ComponentProps, type ReactNode, useState } from "react";
import { AudioDeviceSettingsDialog } from "@/components/audio-device-settings-dialog";
import { Button } from "@/components/ui/button";
import { ShortcutKeys } from "@/components/ui/shortcut-keys";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRoomActionShortcuts } from "@/hooks/use-room-action-shortcuts";
import {
  ConnectionState,
  ScreenShareStatus,
  useVoiceRoom,
} from "@/hooks/use-voice-room";
import {
  appConfig,
  getShortcutDisplayKeys,
  type RoomShortcutActionId,
} from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  GithubIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  PowerIcon,
  Settings2Icon,
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

type RoomControlButtonProps = {
  actionId: RoomShortcutActionId;
  ariaKeyshortcuts: string;
  className: string;
  disabled: boolean;
  icon: ReactNode;
  isShortcutRevealActive: boolean;
  label: string;
  onPress: () => Promise<void> | void;
  shortcutKeys: readonly string[];
  variant: ComponentProps<typeof Button>["variant"];
};

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
    audioDevices,
    selectedMicrophoneId,
    selectedSpeakerId,
    audioDeviceStatus,
    refreshAudioDevices,
    selectMicrophone,
    selectSpeaker,
    toggleMute,
    toggleAfk,
    startScreenShare,
    stopScreenShare,
    disconnect,
  } = useVoiceRoom();
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);

  const handleDisconnect = async () => {
    disconnect();
    await onDisconnect();
  };

  const handleAudioSettingsOpenChange = (nextOpen: boolean) => {
    setIsAudioSettingsOpen(nextOpen);
    if (nextOpen) {
      void refreshAudioDevices();
    }
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
  const muteButtonLabel = isMuted ? "Unmute microphone" : "Mute microphone";
  const afkButtonLabel = isAfk ? "Return from AFK" : "Go AFK";
  const screenShareButtonLabel = isSelfPresenting
    ? "Stop sharing"
    : activeScreenShareUserId
      ? "Take over share"
      : "Share screen";
  const handleScreenShareAction = async () => {
    if (isSelfPresenting) {
      stopScreenShare();
      return;
    }

    await startScreenShare();
  };
  const { isShortcutRevealActive, shortcutPlatform } = useRoomActionShortcuts({
    actions: {
      mute: {
        disabled: muteDisabled,
        onTrigger: toggleMute,
      },
      afk: {
        disabled: afkDisabled,
        onTrigger: toggleAfk,
      },
      screenShare: {
        disabled: screenShareDisabled,
        onTrigger: handleScreenShareAction,
      },
      disconnect: {
        disabled: false,
        onTrigger: handleDisconnect,
      },
    },
  });
  const roomControlButtons: RoomControlButtonProps[] = [
    {
      actionId: "mute",
      ariaKeyshortcuts:
        appConfig.roomControls.shortcuts.bindings.mute.ariaKeyshortcuts,
      className: cn(
        "border-primary/50 px-6 font-mono uppercase tracking-wider transition-all duration-300",
        isMuted
          ? "border-destructive bg-destructive/20 text-destructive hover:bg-destructive/30"
          : "text-primary hover:border-primary hover:bg-primary/10",
      ),
      disabled: muteDisabled,
      icon: isMuted ? <MicOffIcon /> : <MicIcon />,
      isShortcutRevealActive,
      label: muteButtonLabel,
      onPress: toggleMute,
      shortcutKeys: getShortcutDisplayKeys("mute", shortcutPlatform),
      variant: isMuted ? "destructive" : "outline",
    },
    {
      actionId: "afk",
      ariaKeyshortcuts:
        appConfig.roomControls.shortcuts.bindings.afk.ariaKeyshortcuts,
      className: cn(
        "border-primary/50 px-6 font-mono uppercase tracking-wider transition-all duration-300",
        isAfk
          ? "border-amber-400 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20"
          : "text-primary hover:border-primary hover:bg-primary/10",
      ),
      disabled: afkDisabled,
      icon: isAfk ? <HeadphoneOffIcon /> : <HeadphonesIcon />,
      isShortcutRevealActive,
      label: afkButtonLabel,
      onPress: toggleAfk,
      shortcutKeys: getShortcutDisplayKeys("afk", shortcutPlatform),
      variant: isAfk ? "destructive" : "outline",
    },
    {
      actionId: "screenShare",
      ariaKeyshortcuts:
        appConfig.roomControls.shortcuts.bindings.screenShare.ariaKeyshortcuts,
      className: cn(
        "border-primary/50 px-6 font-mono uppercase tracking-wider transition-all duration-300",
        isSelfPresenting
          ? "border-destructive bg-destructive/20 text-destructive hover:bg-destructive/30"
          : "text-primary hover:border-primary hover:bg-primary/10",
      ),
      disabled: screenShareDisabled,
      icon: <MonitorIcon />,
      isShortcutRevealActive,
      label: screenShareButtonLabel,
      onPress: handleScreenShareAction,
      shortcutKeys: getShortcutDisplayKeys("screenShare", shortcutPlatform),
      variant: isSelfPresenting ? "destructive" : "outline",
    },
    {
      actionId: "disconnect",
      ariaKeyshortcuts:
        appConfig.roomControls.shortcuts.bindings.disconnect.ariaKeyshortcuts,
      className:
        "border-destructive/50 px-6 font-mono uppercase tracking-wider text-destructive transition-all duration-300 hover:border-destructive hover:bg-destructive/10",
      disabled: false,
      icon: <PowerIcon />,
      isShortcutRevealActive,
      label: "Disconnect",
      onPress: handleDisconnect,
      shortcutKeys: getShortcutDisplayKeys("disconnect", shortcutPlatform),
      variant: "outline",
    },
  ];

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="fixed right-4 top-4 z-30 sm:right-6 sm:top-6">
        <Button
          aria-label="Open audio settings"
          className="border-primary/40 bg-black/60 text-primary shadow-[0_0_24px_rgba(0,255,65,0.18)] backdrop-blur-sm hover:bg-primary/10"
          data-testid="audio-settings-trigger"
          onClick={() => handleAudioSettingsOpenChange(true)}
          size="icon"
          variant="outline"
        >
          <Settings2Icon />
        </Button>
      </div>

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

      <TooltipProvider
        delayDuration={appConfig.roomControls.shortcuts.tooltip.hoverDelayMs}
      >
        <div className="flex flex-wrap justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          {roomControlButtons.map((button) => (
            <RoomControlButton key={button.actionId} {...button} />
          ))}
        </div>
      </TooltipProvider>

      <Footer />

      <AudioDeviceSettingsDialog
        audioDeviceStatus={audioDeviceStatus}
        audioDevices={audioDevices}
        isOpen={isAudioSettingsOpen}
        onOpenChange={handleAudioSettingsOpenChange}
        onSelectMicrophone={selectMicrophone}
        onSelectSpeaker={selectSpeaker}
        selectedMicrophoneId={selectedMicrophoneId}
        selectedSpeakerId={selectedSpeakerId}
      />
    </div>
  );
}

const RoomControlButton = ({
  actionId,
  ariaKeyshortcuts,
  className,
  disabled,
  icon,
  isShortcutRevealActive,
  label,
  onPress,
  shortcutKeys,
  variant,
}: RoomControlButtonProps) => {
  const [isHoverTooltipOpen, setIsHoverTooltipOpen] = useState(false);
  const isTooltipOpen = isShortcutRevealActive || isHoverTooltipOpen;
  const showTooltipLabel = isHoverTooltipOpen;
  const renderedShortcutKeys = showTooltipLabel
    ? shortcutKeys
    : shortcutKeys.slice(-1);
  const button = (
    <Button
      onClick={() => void onPress()}
      aria-label={label}
      aria-keyshortcuts={ariaKeyshortcuts}
      data-testid={`room-control-${actionId}`}
      disabled={disabled}
      variant={variant}
      className={cn("relative", className)}
    >
      {icon}
    </Button>
  );

  return (
    <Tooltip open={isTooltipOpen} onOpenChange={setIsHoverTooltipOpen}>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent
        data-testid={`room-control-tooltip-${actionId}`}
        className={cn(
          "flex items-center font-mono",
          showTooltipLabel ? "gap-1.5" : "justify-center",
        )}
        side="top"
      >
        {showTooltipLabel ? (
          <span className="text-[11px] leading-none">{label}</span>
        ) : null}
        <ShortcutKeys
          keys={renderedShortcutKeys}
          keyClassName="min-w-5 px-1.5 py-0.5 text-[8px]"
        />
      </TooltipContent>
    </Tooltip>
  );
};

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
