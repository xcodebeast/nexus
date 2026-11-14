import { GithubIcon } from "lucide-react";
import { appConfig } from "@/lib/config";

export function AppFooter() {
  return (
    <footer className="absolute inset-x-0 bottom-4 flex justify-center text-center animate-in fade-in duration-1000 delay-500">
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
          rel="noopener noreferrer"
        >
          {appConfig.creatorName}
        </a>
      </div>
    </footer>
  );
}
