import "./styles//globals.css";

import { useState, useEffect } from "react";
import { MatrixRain } from "@/components/matrix-rain";
import { LoginModal } from "@/components/login-modal";
import { VoiceRoom } from "@/components/voice-room";
import { Button } from "@/components/ui/button";
import { createSession, deleteSession, getSession } from "@/lib/api";

type AppState = "intro" | "connect" | "room";

function shouldSkipIntro() {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("skipIntro")
  );
}

export function App() {
  const [appState, setAppState] = useState<AppState>(() =>
    shouldSkipIntro() ? "connect" : "intro",
  );
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [introComplete, setIntroComplete] = useState(() => shouldSkipIntro());

  useEffect(() => {
    const stored = localStorage.getItem("nexus-username");
    if (stored) {
      setSavedUsername(stored);
    }

    void getSession()
      .then((session) => {
        if (!session) {
          return;
        }

        localStorage.setItem("nexus-username", session.user.username);
        setSavedUsername(session.user.username);
        setCurrentUser(session.user.username);
      })
      .catch(() => {
        return;
      });
  }, []);

  useEffect(() => {
    if (!introComplete) {
      return;
    }

    setAppState(currentUser ? "room" : "connect");
  }, [currentUser, introComplete]);

  const handleIntroComplete = () => {
    setIntroComplete(true);
    setAppState(currentUser ? "room" : "connect");
  };

  const handleConnect = () => {
    setShowLoginModal(true);
  };

  const handleLogin = async (username: string, password: string) => {
    const session = await createSession({ username, password });
    localStorage.setItem("nexus-username", session.user.username);
    setSavedUsername(session.user.username);
    setCurrentUser(session.user.username);
    setShowLoginModal(false);
    setAppState("room");
  };

  const handleDisconnect = async () => {
    try {
      await deleteSession();
    } finally {
      setCurrentUser(null);
      setAppState("connect");
    }
  };

  return (
    <main className="relative min-h-screen bg-background overflow-hidden">
      <MatrixRain
        introMode={appState === "intro"}
        onIntroComplete={handleIntroComplete}
      />

      {appState === "intro" && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center animate-pulse">
            <h1 className="text-4xl sm:text-6xl font-mono font-bold text-primary tracking-[0.3em] drop-shadow-[0_0_20px_rgba(0,255,65,0.8)]">
              NEXUS
            </h1>
          </div>
        </div>
      )}

      {appState === "connect" && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center">
            <h1 
              className="text-4xl sm:text-6xl font-mono font-bold text-primary tracking-[0.3em] mb-8 animate-in fade-in slide-in-from-top-4 duration-700 drop-shadow-[0_0_15px_rgba(0,255,65,0.6)]"
            >
              NEXUS
            </h1>
            <Button
              onClick={handleConnect}
              className="
                px-8 py-6 text-lg font-mono uppercase tracking-widest
                bg-transparent border-2 border-primary text-primary
                hover:bg-primary hover:text-primary-foreground
                transition-all duration-500
                shadow-[0_0_20px_rgba(0,255,65,0.3)]
                hover:shadow-[0_0_40px_rgba(0,255,65,0.6)]
                animate-in fade-in zoom-in-95 duration-700 delay-300
              "
            >
              {">"} Connect
            </Button>
            <p className="mt-6 text-xs font-mono text-muted-foreground animate-in fade-in duration-1000 delay-500">
              Voice communication channel
            </p>
          </div>
        </div>
      )}

      {appState === "room" && currentUser && (
        <div className="relative z-10">
          <VoiceRoom currentUser={currentUser} onDisconnect={handleDisconnect} />
        </div>
      )}

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLogin={handleLogin}
        savedUsername={savedUsername}
      />

      <div 
        className="fixed inset-0 pointer-events-none z-20 opacity-[0.03]"
        style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 65, 0.1) 2px, rgba(0, 255, 65, 0.1) 4px)",
        }}
      />
    </main>
  );
}
