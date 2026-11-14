import { useRef, useState } from "react";
import type { ClientEvent } from "@/lib/protocol";
import {
  applyBoardUpdate,
  type BoardCommand,
  type BoardSnapshot,
  type BoardUpdate,
} from "@/lib/whiteboard";

export function useWhiteboard(sendEvent: (event: ClientEvent) => boolean) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>({
    epoch: 0,
    strokes: [],
  });
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const readyRef = useRef(false);
  const openRef = useRef(false);

  function replace(next: BoardSnapshot) {
    snapshotRef.current = next;
    setSnapshot(next);
  }

  function receiveSnapshot(next: BoardSnapshot) {
    if (!openRef.current) return;
    replace(next);
    readyRef.current = true;
    setIsReady(true);
    setError(null);
  }

  function receiveUpdate(update: BoardUpdate) {
    if (!openRef.current) return;
    replace(applyBoardUpdate(snapshotRef.current, update));
  }

  function send(command: BoardCommand) {
    if (!readyRef.current || command.epoch !== snapshotRef.current.epoch)
      return false;
    const sent = sendEvent({ type: "whiteboard:command", command });
    if (!sent)
      setError(
        "Whiteboard connection interrupted. Wait for the room to reconnect.",
      );
    else setError(null);
    return sent;
  }

  function reset() {
    readyRef.current = false;
    setIsReady(false);
    replace({ epoch: 0, strokes: [] });
    setError(null);
  }

  function reconnect() {
    if (openRef.current) sendEvent({ type: "whiteboard:subscribe" });
  }

  function toggle() {
    if (openRef.current) close();
    else {
      openRef.current = true;
      setIsOpen(true);
      reconnect();
    }
  }

  function close() {
    openRef.current = false;
    setIsOpen(false);
    sendEvent({ type: "whiteboard:unsubscribe" });
    reset();
  }

  return {
    snapshot,
    isReady,
    isOpen,
    error,
    send,
    receiveSnapshot,
    receiveUpdate,
    reset,
    reconnect,
    toggle,
    close,
    setError,
  };
}
