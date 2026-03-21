import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
  savedUsername: string | null;
}

export function LoginModal({ isOpen, onClose, onLogin, savedUsername }: LoginModalProps) {
  const [username, setUsername] = useState(savedUsername || "");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (savedUsername) {
      setUsername(savedUsername);
    }
  }, [savedUsername]);

  const triggerError = (message: string) => {
    setErrorMessage(message);
    setShake(true);
    setTimeout(() => {
      setShake(false);
    }, 500);
    setTimeout(() => {
      setErrorMessage(null);
    }, 1500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextUsername = username.trim();
    if (!nextUsername) {
      triggerError("ACCESS DENIED - Username required");
      return;
    }

    setIsSubmitting(true);

    try {
      await onLogin(nextUsername, password);
      setPassword("");
      setErrorMessage(null);
    } catch (cause) {
      triggerError(
        cause instanceof Error
          ? cause.message
          : "ACCESS DENIED - Invalid credentials",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className={`
          bg-card/95 border-primary/30 backdrop-blur-md
          transition-all duration-300
          ${shake ? "animate-shake" : ""}
          ${errorMessage ? "border-destructive shadow-[0_0_30px_rgba(255,0,64,0.3)]" : "shadow-[0_0_30px_rgba(0,255,65,0.2)]"}
        `}
        style={{
          filter: errorMessage ? "blur(1px)" : "none",
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-primary font-mono text-xl tracking-wider">
            {">"} ACCESS TERMINAL
          </DialogTitle>
          <DialogDescription className="text-muted-foreground font-mono text-sm">
            Enter credentials to join the voice channel
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          {!savedUsername && (
            <div className="space-y-2">
              <Label htmlFor="username" className="text-primary/80 font-mono text-xs uppercase tracking-wider">
                Username
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isSubmitting}
                className="bg-input border-primary/30 text-primary font-mono placeholder:text-muted-foreground/50 focus:border-primary focus:ring-primary/20"
                placeholder="Enter username..."
                autoComplete="off"
              />
            </div>
          )}
          
          {savedUsername && (
            <div className="text-sm font-mono text-muted-foreground">
              Logging in as: <span className="text-primary">{savedUsername}</span>
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="password" className="text-primary/80 font-mono text-xs uppercase tracking-wider">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              className={`
                bg-input border-primary/30 text-primary font-mono placeholder:text-muted-foreground/50 
                focus:border-primary focus:ring-primary/20
                ${errorMessage ? "border-destructive bg-destructive/10" : ""}
              `}
              placeholder="Enter password..."
              autoComplete="off"
            />
            {errorMessage && (
              <p className="text-destructive text-xs font-mono animate-pulse">
                {errorMessage}
              </p>
            )}
          </div>
          
          <Button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wider transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
          >
            {isSubmitting ? (
              <>{">"} Connecting...</>
            ) : (
              <>{">"} Authenticate</>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
