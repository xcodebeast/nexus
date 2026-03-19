"use client";

import { Button } from "@/components/ui/button";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { VoiceAvatar } from "./voice-avatar";

interface VoiceRoomProps {
  currentUser: string;
  onDisconnect: () => Promise<void> | void;
}

function getStatusLabel(connectionState: string) {
  if (connectionState === "requesting-media") {
    return "Requesting microphone access";
  }

  if (connectionState === "connecting") {
    return "Establishing realtime channel";
  }

  if (connectionState === "disconnected") {
    return "Realtime channel offline";
  }

  return "Voice channel active";
}

export function VoiceRoom({ currentUser, onDisconnect }: VoiceRoomProps) {
  const {
    users,
    selfUserId,
    isMuted,
    connectionState,
    error,
    toggleMute,
    disconnect,
  } = useVoiceRoom();

  const handleDisconnect = async () => {
    await disconnect();
    await onDisconnect();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
      <div className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold text-primary tracking-wider mb-2">
          NEXUS
        </h1>
        <p className="text-xs sm:text-sm font-mono text-muted-foreground">
          {getStatusLabel(connectionState)} - {users.length} connected
        </p>
        {error && (
          <p className="mt-3 text-xs font-mono text-destructive">{error}</p>
        )}
      </div>

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

      <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
        <Button
          onClick={toggleMute}
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
          {isMuted ? (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              Muted
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              Unmuted
            </>
          )}
        </Button>

        <Button
          onClick={() => void handleDisconnect()}
          variant="outline"
          className="font-mono uppercase tracking-wider px-6 border-destructive/50 text-destructive hover:bg-destructive/10 hover:border-destructive transition-all duration-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2"
          >
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
          Disconnect
        </Button>
      </div>

      <div className="absolute bottom-4 text-center animate-in fade-in duration-1000 delay-500">
        <p className="text-[10px] font-mono text-muted-foreground/40">
          NEXUS v1.0 - Open Source Voice Communication
        </p>
      </div>
    </div>
  );
}
