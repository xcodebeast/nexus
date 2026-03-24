export type ShortcutPlatform = "mac" | "default";

export type RoomShortcutActionId =
  | "mute"
  | "afk"
  | "screenShare"
  | "disconnect";

type ShortcutModifierConfig = {
  eventKey: "Control";
  displayLabelByPlatform: Record<ShortcutPlatform, string>;
  ariaToken: "Control";
};

type ShortcutTooltipConfig = {
  hoverDelayMs: number;
  revealDelayMs: number;
};

export type ShortcutBinding = {
  key: string;
  displayKey: string;
  ariaKeyshortcuts: string;
};

type Config = {
  /** Display name used across the application shell and room UI. */
  appName: string;
  /** Public repository URL shown in the footer. */
  githubUrl: string;
  /** Human-readable creator name displayed in the footer. */
  creatorName: string;
  /** Creator GitHub profile URL kept alongside the app metadata. */
  creatorGithubUrl: string;
  /** Primary creator website link displayed in the footer. */
  creatorWebsite: string;
  /** Timing and persistence settings for the intro animation flow. */
  introAnimation: {
    /** Duration of the first-visit intro sequence in milliseconds. */
    firstVisitDurationMs: number;
    /** Idle opacity applied to the intro visuals after the animation settles. */
    idleOpacity: number;
    /** Local storage key used to remember that the intro has already been seen. */
    seenStorageKey: string;
  };
  /** Storage keys used by the client application. */
  storage: {
    /** Local storage key used to persist the last authenticated username. */
    usernameKey: string;
    /** Local storage key used to persist the preferred microphone device. */
    microphoneDeviceIdKey: string;
    /** Local storage key used to persist the preferred speaker device. */
    speakerDeviceIdKey: string;
  };
  /** Configuration for room control shortcuts and their tooltip behavior. */
  roomControls: {
    /** Shortcut bindings and reveal behavior for the room action buttons. */
    shortcuts: {
      /** Modifier-key metadata used to resolve the shortcut trigger label per platform. */
      revealModifier: ShortcutModifierConfig;
      /** Tooltip delays for hover hints and modifier-hold shortcut reveal. */
      tooltip: ShortcutTooltipConfig;
      /** Per-action keyboard bindings used by the room controls. */
      bindings: Record<RoomShortcutActionId, ShortcutBinding>;
    };
  };
  /** Semantic application version rendered in the footer and other metadata surfaces. */
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
    microphoneDeviceIdKey: "nexus-microphone-device-id",
    speakerDeviceIdKey: "nexus-speaker-device-id",
  },
  roomControls: {
    shortcuts: {
      revealModifier: {
        eventKey: "Control",
        displayLabelByPlatform: {
          mac: "Control",
          default: "Ctrl",
        },
        ariaToken: "Control",
      },
      tooltip: {
        hoverDelayMs: 100,
        revealDelayMs: 100,
      },
      bindings: {
        mute: {
          key: "m",
          displayKey: "M",
          ariaKeyshortcuts: "Control+M",
        },
        afk: {
          key: "f",
          displayKey: "F",
          ariaKeyshortcuts: "Control+F",
        },
        screenShare: {
          key: "s",
          displayKey: "S",
          ariaKeyshortcuts: "Control+S",
        },
        disconnect: {
          key: "d",
          displayKey: "D",
          ariaKeyshortcuts: "Control+D",
        },
      },
    },
  },
  version: "1.4.1",
} as const satisfies Config;

export function resolveShortcutPlatform(
  platformValue?: string | null,
): ShortcutPlatform {
  const normalizedPlatform = platformValue?.toLowerCase() ?? "";
  return normalizedPlatform.includes("mac") ? "mac" : "default";
}

export function getCurrentShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") {
    return "default";
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return resolveShortcutPlatform(
    navigatorWithUserAgentData.userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  );
}

export function getShortcutModifierLabel(
  platform = getCurrentShortcutPlatform(),
) {
  return appConfig.roomControls.shortcuts.revealModifier.displayLabelByPlatform[
    platform
  ];
}

export function getShortcutDisplayKeys(
  actionId: RoomShortcutActionId,
  platform = getCurrentShortcutPlatform(),
) {
  return [
    getShortcutModifierLabel(platform),
    appConfig.roomControls.shortcuts.bindings[actionId].displayKey,
  ] as const;
}
