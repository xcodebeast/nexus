import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  appConfig,
  getCurrentShortcutPlatform,
  type RoomShortcutActionId,
  type ShortcutBinding,
  type ShortcutPlatform,
} from "@/lib/config";

type ShortcutActionHandler = {
  disabled: boolean;
  onTrigger: () => Promise<void> | void;
};

type UseRoomActionShortcutsOptions = {
  actions: Record<RoomShortcutActionId, ShortcutActionHandler>;
};

const shortcutEntries = Object.entries(
  appConfig.roomControls.shortcuts.bindings,
) as Array<[RoomShortcutActionId, ShortcutBinding]>;

function normalizeKey(key: string) {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function useRoomActionShortcuts({
  actions,
}: UseRoomActionShortcutsOptions) {
  const [isShortcutRevealActive, setIsShortcutRevealActive] = useState(false);
  const [shortcutPlatform] = useState<ShortcutPlatform>(() =>
    getCurrentShortcutPlatform(),
  );
  const revealTimeoutRef = useRef<number | null>(null);
  const suppressRevealUntilModifierReleaseRef = useRef(false);

  const clearRevealTimeout = useEffectEvent(() => {
    if (revealTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = null;
  });

  const scheduleShortcutReveal = useEffectEvent(() => {
    if (
      suppressRevealUntilModifierReleaseRef.current ||
      isShortcutRevealActive ||
      revealTimeoutRef.current !== null
    ) {
      return;
    }

    revealTimeoutRef.current = window.setTimeout(() => {
      revealTimeoutRef.current = null;
      setIsShortcutRevealActive(true);
    }, appConfig.roomControls.shortcuts.tooltip.revealDelayMs);
  });

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.repeat ||
      isEditableElement(event.target) ||
      document.visibilityState === "hidden" ||
      !document.hasFocus()
    ) {
      return;
    }

    const revealModifierKey =
      appConfig.roomControls.shortcuts.revealModifier.eventKey;

    if (event.key === revealModifierKey) {
      scheduleShortcutReveal();
      return;
    }

    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }

    const shortcutEntry = shortcutEntries.find(([, binding]) => {
      return binding.key === normalizeKey(event.key);
    });

    if (!shortcutEntry) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearRevealTimeout();
    setIsShortcutRevealActive(false);
    suppressRevealUntilModifierReleaseRef.current = true;

    const [actionId] = shortcutEntry;
    if (actions[actionId].disabled) {
      return;
    }

    void actions[actionId].onTrigger();
  });

  const handleKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === appConfig.roomControls.shortcuts.revealModifier.eventKey) {
      clearRevealTimeout();
      setIsShortcutRevealActive(false);
      suppressRevealUntilModifierReleaseRef.current = false;
    }
  });

  const resetShortcutReveal = useEffectEvent(() => {
    clearRevealTimeout();
    setIsShortcutRevealActive(false);
    suppressRevealUntilModifierReleaseRef.current = false;
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", resetShortcutReveal);
    document.addEventListener("visibilitychange", resetShortcutReveal);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", resetShortcutReveal);
      document.removeEventListener("visibilitychange", resetShortcutReveal);
    };
  }, []);

  return {
    isShortcutRevealActive,
    shortcutPlatform,
  };
}
