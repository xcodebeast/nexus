type Config = {
  appName: string;
  githubUrl: string;
  creatorName: string;
  creatorGithubUrl: string;
  creatorWebsite: string;
  introAnimation: {
    firstVisitDurationMs: number;
    idleOpacity: number;
    seenStorageKey: string;
  };
  storage: {
    usernameKey: string;
  };
  version: `${number}.${number}.${number}`;
};

export const appConfig = {
  appName: "NEXUS",
  githubUrl: "https://github.com/xcodebeast/nexus",
  creatorName: "Codebeast",
  creatorGithubUrl: "https://github.com/xcodebeast",
  creatorWebsite: "https://codebeast.io",
  introAnimation: {
    firstVisitDurationMs: 4200,
    idleOpacity: 0.15,
    seenStorageKey: "nexus-intro-seen",
  },
  storage: {
    usernameKey: "nexus-username",
  },
  version: "1.0.0",
} as const satisfies Config;
