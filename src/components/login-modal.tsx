"use client";

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
  onLogin: (username: string) => void;
  savedUsername: string | null;
}

const CORRECT_PASSWORD = "nexus"; // Mock password for demo

export function LoginModal({ isOpen, onClose, onLogin, savedUsername }: LoginModalProps) {
  const [username, setUsername] = useState(savedUsername || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (savedUsername) {
      setUsername(savedUsername);
    }
  }, [savedUsername]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password === CORRECT_PASSWORD && username.trim()) {
      // Store username in localStorage
      localStorage.setItem("nexus-username", username.trim());
      onLogin(username.trim());
      setPassword("");
      setError(false);
    } else {
      // Error animation
      setError(true);
      setShake(true);
      setTimeout(() => {
        setShake(false);
      }, 500);
      setTimeout(() => {
        setError(false);
      }, 1500);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className={`
          bg-card/95 border-primary/30 backdrop-blur-md
          transition-all duration-300
          ${shake ? "animate-shake" : ""}
          ${error ? "border-destructive shadow-[0_0_30px_rgba(255,0,64,0.3)]" : "shadow-[0_0_30px_rgba(0,255,65,0.2)]"}
        `}
        style={{
          filter: error ? "blur(1px)" : "none",
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
              className={`
                bg-input border-primary/30 text-primary font-mono placeholder:text-muted-foreground/50 
                focus:border-primary focus:ring-primary/20
                ${error ? "border-destructive bg-destructive/10" : ""}
              `}
              placeholder="Enter password..."
              autoComplete="off"
            />
            {error && (
              <p className="text-destructive text-xs font-mono animate-pulse">
                ACCESS DENIED - Invalid credentials
              </p>
            )}
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wider transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
          >
            {">"} Authenticate
          </Button>
          
          <p className="text-xs text-muted-foreground/60 font-mono text-center">
            Hint: password is &quot;nexus&quot;
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
