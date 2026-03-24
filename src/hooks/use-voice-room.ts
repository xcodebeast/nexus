import { useEffect, useRef, useState } from "react";
import { appConfig } from "@/lib/config";
import type {
  ClientEvent,
  RoomUser,
  ServerEvent,
  SignalChannel,
  WebRtcSignal,
} from "@/lib/protocol";
import {
  prepareLocalAudio,
  type AudioProcessingMode,
  type AudioProcessingReason,
  type PreparedLocalAudio,
} from "@/lib/audio/noise-processing";
import {
  playNotificationCue,
  resumeNotificationAudio,
  type NotificationCue,
} from "@/lib/audio/notification-sounds";

export interface AudioDeviceOption {
  id: string;
  label: string;
  isDefault: boolean;
}

interface AudioDeviceCollection {
  microphones: AudioDeviceOption[];
  speakers: AudioDeviceOption[];
}

type AudioOutputElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

export enum ScreenShareStatus {
  Unsupported = "unsupported",
  Idle = "idle",
  Requesting = "requesting",
  Starting = "starting",
  Sharing = "sharing",
  Stopping = "stopping",
}

export enum ConnectionState {
  RequestingMedia = "requesting-media",
  Connecting = "connecting",
  Reconnecting = "reconnecting",
  Disconnected = "disconnected",
  Connected = "connected",
}

function buildWebSocketUrl(pathname: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}

const sortUsers = (users: RoomUser[]) => [...users].sort((left, right) => left.connectedAt - right.connectedAt);

function hasTurnRelay(rtcConfiguration: RTCConfiguration) {
  return (rtcConfiguration.iceServers ?? []).some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(
      (url) => typeof url === "string" && /^(turn|turns):/i.test(url),
    );
  });
}

function getPeerConnectionFailedMessage(hasTurnRelayConfigured: boolean) {
  if (!hasTurnRelayConfigured) return "Peer audio connection failed. TURN relay is not configured, so callers on different networks may not hear each other.";

  return "Peer audio connection failed. Check network access and reconnect.";
}

function getMicrophoneUnavailableMessage() {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (!window.isSecureContext && !isLocalhost) return "Microphone access requires HTTPS or localhost.";

  return "Microphone access is unavailable in this browser.";
}

function getMicrophoneResumeErrorMessage(cause: unknown) {
  if (cause instanceof DOMException) {
    if (
      cause.name === "NotAllowedError" ||
      cause.name === "PermissionDeniedError" ||
      cause.name === "SecurityError"
    ) {
      return "Microphone access is required to unmute.";
    }

    if (
      cause.name === "NotFoundError" ||
      cause.name === "DevicesNotFoundError"
    ) {
      return "No microphone is available. Connect one and try again.";
    }

    if (
      cause.name === "NotReadableError" ||
      cause.name === "TrackStartError"
    ) {
      return "Microphone is unavailable. Close other apps using it and try again.";
    }
  }

  return cause instanceof Error
    ? cause.message
    : "Microphone access is required to unmute.";
}

function supportsScreenShare() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function getInitialScreenShareStatus(): ScreenShareStatus {
  if (typeof navigator === "undefined") return ScreenShareStatus.Idle;

  return supportsScreenShare() ? ScreenShareStatus.Idle : ScreenShareStatus.Unsupported;
}

const remotePlaybackBlockedMessage = "Remote audio is waiting for a browser interaction. Click anywhere or use a control to resume playback.";
const realtimeReconnectingMessage = "Realtime connection lost. Reconnecting...";
const sessionUnavailableMessage = "Realtime session expired. Reconnect from the access terminal.";
const sessionTakenOverMessage = "Realtime session moved to another browser tab or window.";
const audioDeviceEnumerationUnavailableMessage =
  "Audio device selection is unavailable in this browser.";
const speakerSelectionUnsupportedMessage =
  "Speaker selection is available in supported Chromium-based browsers.";
const selectedMicrophoneMissingMessage =
  "Selected microphone disconnected. Switched to the default microphone.";
const selectedSpeakerMissingMessage =
  "Selected speaker disconnected. Switched to the system default output.";
const screenShareUnavailableMessage = "Screen sharing is available in desktop Chromium browsers with display capture support.";
const screenShareCancelledMessage = "Screen sharing was cancelled before it started.";
const screenShareFailedMessage = "Screen sharing could not start. Try again.";
const screenShareConnectionFailedMessage = "Screen share connection failed. Ask the presenter to restart sharing.";
const screenShareNotReadyMessage = "Realtime connection is not ready for screen sharing yet.";
const screenShareAfkMessage = "Return from AFK to share your screen.";

function getScreenShareNotificationCue(
  previousUserId: string | null,
  nextUserId: string | null,
): NotificationCue | null {
  if (previousUserId === nextUserId) {
    return null;
  }

  if (!previousUserId && nextUserId) {
    return "screen-share-start";
  }

  if (previousUserId) {
    return "screen-share-stop";
  }

  return null;
}

interface PresenceState {
  isMuted: boolean;
  isSpeaking: boolean;
  isAfk: boolean;
}

function supportsSpeakerSelection() {
  if (typeof HTMLMediaElement === "undefined") {
    return false;
  }

  return (
    typeof HTMLMediaElement.prototype === "object" &&
    typeof (HTMLMediaElement.prototype as AudioOutputElement).setSinkId ===
      "function"
  );
}

function readStoredAudioDeviceId(storageKey: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function writeStoredAudioDeviceId(storageKey: string, deviceId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (deviceId) {
      window.localStorage.setItem(storageKey, deviceId);
      return;
    }

    window.localStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function isMissingDeviceError(cause: unknown) {
  return (
    cause instanceof DOMException &&
    (cause.name === "NotFoundError" || cause.name === "DevicesNotFoundError")
  );
}

function shouldSkipEnumeratedDevice(device: MediaDeviceInfo) {
  return device.deviceId === "default" || device.deviceId === "communications";
}

function getFallbackDeviceLabel(
  kind: "audioinput" | "audiooutput",
  index: number,
) {
  return `${kind === "audioinput" ? "Microphone" : "Speaker"} ${index + 1}`;
}

function createDefaultAudioOption(kind: "audioinput" | "audiooutput") {
  return {
    id: "",
    label: kind === "audioinput" ? "Default microphone" : "System default",
    isDefault: true,
  } satisfies AudioDeviceOption;
}

function buildAudioDeviceOptions(
  devices: readonly MediaDeviceInfo[],
  kind: "audioinput" | "audiooutput",
) {
  const defaultOption = createDefaultAudioOption(kind);
  const matchingDevices = devices
    .filter((device) => device.kind === kind && !shouldSkipEnumeratedDevice(device))
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || getFallbackDeviceLabel(kind, index),
      isDefault: false,
    }));

  return [defaultOption, ...matchingDevices];
}

export function useVoiceRoom() {
  const initialScreenShareStatus = getInitialScreenShareStatus();
  const initialSpeakerSelectionSupported = supportsSpeakerSelection();
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isAfk, setIsAfk] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>(ConnectionState.RequestingMedia);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [localCaptureError, setLocalCaptureError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioProcessingMode, setAudioProcessingMode] =
    useState<AudioProcessingMode>("standard");
  const [audioProcessingReason, setAudioProcessingReason] =
    useState<AudioProcessingReason>("unsupported");
  const [activeScreenShareUserId, setActiveScreenShareUserId] = useState<
    string | null
  >(null);
  const [screenShareStatus, setScreenShareStatus] = useState<ScreenShareStatus>(
    initialScreenShareStatus,
  );
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [screenShareNotice, setScreenShareNotice] = useState<string | null>(
    null,
  );
  const [activeScreenStream, setActiveScreenStream] =
    useState<MediaStream | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceCollection>({
    microphones: [createDefaultAudioOption("audioinput")],
    speakers: [createDefaultAudioOption("audiooutput")],
  });
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState(() =>
    readStoredAudioDeviceId(appConfig.storage.microphoneDeviceIdKey),
  );
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(() =>
    initialSpeakerSelectionSupported
      ? readStoredAudioDeviceId(appConfig.storage.speakerDeviceIdKey)
      : "",
  );
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(true);
  const [microphoneDeviceError, setMicrophoneDeviceError] = useState<
    string | null
  >(null);
  const [speakerDeviceError, setSpeakerDeviceError] = useState<string | null>(
    initialSpeakerSelectionSupported ? null : speakerSelectionUnsupportedMessage,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const selfUserIdRef = useRef<string | null>(null);
  const usersRef = useRef<RoomUser[]>([]);
  const localAudioRef = useRef<PreparedLocalAudio | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const screenPeerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceCandidatesRef = useRef(
    new Map<string, RTCIceCandidateInit[]>(),
  );
  const pendingScreenIceCandidatesRef = useRef(
    new Map<string, RTCIceCandidateInit[]>(),
  );
  const audioElementsRef = useRef(new Map<string, HTMLAudioElement>());
  const rtcConfigurationRef = useRef<RTCConfiguration>({
    iceServers: [],
  });
  const speechFrameRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const manualMutedRef = useRef(false);
  const isMutedRef = useRef(false);
  const isAfkRef = useRef(false);
  const speakingRef = useRef(false);
  const hasTurnRelayRef = useRef(false);
  const failedPeersRef = useRef(new Set<string>());
  const blockedAudioPeersRef = useRef(new Set<string>());
  const activeScreenShareUserIdRef = useRef<string | null>(null);
  const screenShareStatusRef =
    useRef<ScreenShareStatus>(initialScreenShareStatus);
  const activeScreenStreamRef = useRef<MediaStream | null>(null);
  const selectedMicrophoneIdRef = useRef(selectedMicrophoneId);
  const selectedSpeakerIdRef = useRef(selectedSpeakerId);
  const microphoneSwapInFlightRef = useRef(false);
  const speakerSelectionInFlightRef = useRef(false);

  function setUsersState(nextUsers: RoomUser[]) {
    usersRef.current = nextUsers;
    setUsers(nextUsers);
  }

  function setUsersWithUpdater(updater: (users: RoomUser[]) => RoomUser[]) {
    setUsers((previousUsers) => {
      const nextUsers = updater(previousUsers);
      usersRef.current = nextUsers;
      return nextUsers;
    });
  }

  function setScreenShareStatusState(nextStatus: ScreenShareStatus) {
    screenShareStatusRef.current = nextStatus;
    setScreenShareStatus(nextStatus);
  }

  function setActiveScreenStreamState(stream: MediaStream | null) {
    activeScreenStreamRef.current = stream;
    setActiveScreenStream(stream);
  }

  function setSelectedMicrophoneIdState(nextDeviceId: string) {
    selectedMicrophoneIdRef.current = nextDeviceId;
    setSelectedMicrophoneId(nextDeviceId);
  }

  function setSelectedSpeakerIdState(nextDeviceId: string) {
    selectedSpeakerIdRef.current = nextDeviceId;
    setSelectedSpeakerId(nextDeviceId);
  }

  function sendEvent(event: ClientEvent) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(event));
  }

  function sendSignal(
    channel: SignalChannel,
    targetUserId: string,
    signal: WebRtcSignal,
  ) {
    sendEvent({
      type: "signal",
      channel,
      targetUserId,
      signal,
    });
  }

  function updateUser(user: RoomUser) {
    setUsersWithUpdater((previousUsers) => {
      const nextUsers = previousUsers.filter(
        (existingUser) => existingUser.id !== user.id,
      );
      nextUsers.push(user);
      return sortUsers(nextUsers);
    });
  }

  function removeUser(userId: string) {
    setUsersWithUpdater((previousUsers) =>
      previousUsers.filter((user) => user.id !== userId),
    );
  }

  function getUserName(userId: string | null) {
    if (!userId) {
      return null;
    }

    return usersRef.current.find((user) => user.id === userId)?.username ?? null;
  }

  function getUser(userId: string) {
    return usersRef.current.find((user) => user.id === userId) ?? null;
  }

  function getEffectiveMuted(
    options: { manualMuted?: boolean; isAfk?: boolean } = {},
  ) {
    const manualMuted = options.manualMuted ?? manualMutedRef.current;
    const isAfk = options.isAfk ?? isAfkRef.current;
    return manualMuted || isAfk;
  }

  function createPresenceState(
    overrides: Partial<PresenceState> = {},
  ): PresenceState {
    const isAfk = overrides.isAfk ?? isAfkRef.current;
    const isMuted = isAfk
      ? true
      : overrides.isMuted ?? getEffectiveMuted({ isAfk });
    const isSpeaking =
      isAfk || isMuted ? false : overrides.isSpeaking ?? speakingRef.current;

    return {
      isMuted,
      isSpeaking,
      isAfk,
    };
  }

  function syncPresence(nextPresence: PresenceState) {
    const presence = createPresenceState(nextPresence);
    const selfUserId = selfUserIdRef.current;
    if (selfUserId) {
      setUsersWithUpdater((previousUsers) =>
        previousUsers.map((user) =>
          user.id === selfUserId
            ? {
                ...user,
                isAfk: presence.isAfk,
                isMuted: presence.isMuted,
                isSpeaking: presence.isSpeaking,
              }
            : user,
        ),
      );
    }

    sendEvent({
      type: "presence:update",
      isMuted: presence.isMuted,
      isSpeaking: presence.isSpeaking,
      isAfk: presence.isAfk,
    });
  }

  async function setEffectiveMutedState(nextMuted: boolean) {
    const localAudio = localAudioRef.current;
    if (localAudio) {
      await localAudio.setMuted(nextMuted);
    }

    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    setLocalCaptureError(null);
  }

  async function restoreMutedStateAfterResumeFailure(cause: unknown) {
    setLocalCaptureError(getMicrophoneResumeErrorMessage(cause));
    manualMutedRef.current = true;
    speakingRef.current = false;

    try {
      await localAudioRef.current?.setMuted(true);
    } catch {
      // Best effort: keep the browser capture released even if the retry also fails.
    }

    isMutedRef.current = true;
    setIsMuted(true);
  }

  function syncMediaError() {
    if (blockedAudioPeersRef.current.size > 0) {
      setMediaError(remotePlaybackBlockedMessage);
      return;
    }

    if (failedPeersRef.current.size > 0) {
      setMediaError(getPeerConnectionFailedMessage(hasTurnRelayRef.current));
      return;
    }

    setMediaError(null);
  }

  async function createPreparedLocalAudio(deviceId: string) {
    return prepareLocalAudio({
      deviceId: deviceId || undefined,
      onStateChange: (state) => {
        setAudioProcessingMode(state.mode);
        setAudioProcessingReason(state.reason);
      },
    });
  }

  async function replaceOutgoingAudioTracks(stream: MediaStream) {
    const [nextTrack] = stream.getAudioTracks();

    for (const peer of peerConnectionsRef.current.values()) {
      const sender = peer
        .getSenders()
        .find((candidate) => candidate.track?.kind === "audio");

      if (sender) {
        await sender.replaceTrack(nextTrack ?? null);
        continue;
      }

      if (nextTrack) {
        peer.addTrack(nextTrack, stream);
      }
    }
  }

  async function applySpeakerSelectionToElement(
    audio: HTMLAudioElement,
    deviceId: string,
  ) {
    const outputAudio = audio as AudioOutputElement;
    if (typeof outputAudio.setSinkId !== "function") {
      return;
    }

    if ((outputAudio.sinkId ?? "") === deviceId) {
      return;
    }

    await outputAudio.setSinkId(deviceId);
  }

  async function selectSpeaker(
    nextDeviceId: string,
    options: { persist?: boolean; successMessage?: string | null } = {},
  ) {
    if (!initialSpeakerSelectionSupported) {
      setSelectedSpeakerIdState("");
      writeStoredAudioDeviceId(appConfig.storage.speakerDeviceIdKey, "");
      setSpeakerDeviceError(speakerSelectionUnsupportedMessage);
      return;
    }

    if (speakerSelectionInFlightRef.current) {
      return;
    }

    const previousDeviceId = selectedSpeakerIdRef.current;
    speakerSelectionInFlightRef.current = true;
    setAudioDevicesLoading(true);
    setSpeakerDeviceError(null);

    try {
      for (const audio of audioElementsRef.current.values()) {
        await applySpeakerSelectionToElement(audio, nextDeviceId);
      }

      setSelectedSpeakerIdState(nextDeviceId);
      if (options.persist ?? true) {
        writeStoredAudioDeviceId(
          appConfig.storage.speakerDeviceIdKey,
          nextDeviceId,
        );
      }
      setSpeakerDeviceError(options.successMessage ?? null);
    } catch (cause) {
      for (const audio of audioElementsRef.current.values()) {
        try {
          await applySpeakerSelectionToElement(audio, previousDeviceId);
        } catch {
          // Best effort: leave playback on whichever sink the browser accepted.
        }
      }

      setSpeakerDeviceError(
        isMissingDeviceError(cause)
          ? "Selected speaker is unavailable. Switched back to the previous output."
          : cause instanceof Error
            ? cause.message
            : "Speaker output could not be changed. Try again.",
      );
    } finally {
      speakerSelectionInFlightRef.current = false;
      setAudioDevicesLoading(false);
    }
  }

  async function refreshAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioDevices({
        microphones: [createDefaultAudioOption("audioinput")],
        speakers: [createDefaultAudioOption("audiooutput")],
      });
      setAudioDevicesLoading(false);
      setMicrophoneDeviceError(audioDeviceEnumerationUnavailableMessage);
      setSpeakerDeviceError(
        initialSpeakerSelectionSupported
          ? audioDeviceEnumerationUnavailableMessage
          : speakerSelectionUnsupportedMessage,
      );
      return;
    }

    setAudioDevicesLoading(true);

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextAudioDevices = {
        microphones: buildAudioDeviceOptions(devices, "audioinput"),
        speakers: buildAudioDeviceOptions(devices, "audiooutput"),
      };

      setAudioDevices(nextAudioDevices);
      setMicrophoneDeviceError((currentError) =>
        currentError === audioDeviceEnumerationUnavailableMessage
          ? null
          : currentError,
      );
      if (initialSpeakerSelectionSupported) {
        setSpeakerDeviceError((currentError) =>
          currentError === audioDeviceEnumerationUnavailableMessage
            ? null
            : currentError,
        );
      }

      if (
        selectedMicrophoneIdRef.current &&
        !nextAudioDevices.microphones.some(
          (device) => device.id === selectedMicrophoneIdRef.current,
        )
      ) {
        await selectMicrophone("", {
          successMessage: selectedMicrophoneMissingMessage,
        });
      }

      if (
        selectedSpeakerIdRef.current &&
        !nextAudioDevices.speakers.some(
          (device) => device.id === selectedSpeakerIdRef.current,
        )
      ) {
        await selectSpeaker("", {
          successMessage: selectedSpeakerMissingMessage,
        });
      }
    } catch {
      setAudioDevices({
        microphones: [createDefaultAudioOption("audioinput")],
        speakers: [createDefaultAudioOption("audiooutput")],
      });
      setMicrophoneDeviceError(audioDeviceEnumerationUnavailableMessage);
      setSpeakerDeviceError(
        initialSpeakerSelectionSupported
          ? audioDeviceEnumerationUnavailableMessage
          : speakerSelectionUnsupportedMessage,
      );
    } finally {
      setAudioDevicesLoading(false);
    }
  }

  async function selectMicrophone(
    nextDeviceId: string,
    options: { persist?: boolean; successMessage?: string | null } = {},
  ) {
    if (microphoneSwapInFlightRef.current) {
      return;
    }

    const previousLocalAudio = localAudioRef.current;
    const previousDeviceId = selectedMicrophoneIdRef.current;
    let nextLocalAudio: PreparedLocalAudio | null = null;

    microphoneSwapInFlightRef.current = true;
    setAudioDevicesLoading(true);
    setMicrophoneDeviceError(null);

    try {
      nextLocalAudio = await createPreparedLocalAudio(nextDeviceId);
      await nextLocalAudio.setMuted(getEffectiveMuted());
      await replaceOutgoingAudioTracks(nextLocalAudio.outboundStream);
      stopSpeechDetection();
      localAudioRef.current = nextLocalAudio;
      startSpeechDetection(nextLocalAudio.analyser);
      previousLocalAudio?.destroy();
      setSelectedMicrophoneIdState(nextDeviceId);
      if (options.persist ?? true) {
        writeStoredAudioDeviceId(
          appConfig.storage.microphoneDeviceIdKey,
          nextDeviceId,
        );
      }
      setLocalCaptureError(null);
      setMicrophoneDeviceError(options.successMessage ?? null);
      await refreshAudioDevices();
    } catch (cause) {
      nextLocalAudio?.destroy();
      localAudioRef.current = previousLocalAudio;
      setSelectedMicrophoneIdState(previousDeviceId);
      setMicrophoneDeviceError(getMicrophoneResumeErrorMessage(cause));
    } finally {
      microphoneSwapInFlightRef.current = false;
      setAudioDevicesLoading(false);
    }
  }

  function clearPeerFailure(peerId: string) {
    if (!failedPeersRef.current.delete(peerId)) {
      return;
    }

    syncMediaError();
  }

  function markPeerFailure(peerId: string) {
    failedPeersRef.current.add(peerId);
    syncMediaError();
  }

  function clearBlockedAudio(peerId: string) {
    if (!blockedAudioPeersRef.current.delete(peerId)) {
      return;
    }

    syncMediaError();
  }

  async function tryPlayRemoteAudio(peerId: string, audio: HTMLAudioElement) {
    try {
      await audio.play();
      clearBlockedAudio(peerId);
    } catch (cause) {
      if (
        cause instanceof DOMException &&
        cause.name === "NotAllowedError"
      ) {
        blockedAudioPeersRef.current.add(peerId);
        syncMediaError();
      }
    }
  }

  function retryBlockedAudioPlayback() {
    for (const peerId of [...blockedAudioPeersRef.current]) {
      const audio = audioElementsRef.current.get(peerId);
      if (!audio) {
        blockedAudioPeersRef.current.delete(peerId);
        continue;
      }

      void tryPlayRemoteAudio(peerId, audio);
    }

    syncMediaError();
  }

  function canCreateAudioConnection(peerId: string) {
    return !isAfkRef.current && getUser(peerId)?.isAfk !== true;
  }

  function attachRemoteStream(peerId: string, stream: MediaStream) {
    if (isAfkRef.current) {
      cleanupAudioPeer(peerId);
      return;
    }

    let audio = audioElementsRef.current.get(peerId);

    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.peerId = peerId;
      audio.style.display = "none";
      document.body.append(audio);
      audioElementsRef.current.set(peerId, audio);
    }

    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
    }

    if (selectedSpeakerIdRef.current) {
      void applySpeakerSelectionToElement(audio, selectedSpeakerIdRef.current).catch(
        (cause) => {
          setSpeakerDeviceError(
            cause instanceof Error
              ? cause.message
              : "Speaker output could not be changed. Try again.",
          );
        },
      );
    }

    clearPeerFailure(peerId);
    void tryPlayRemoteAudio(peerId, audio);
  }

  function cleanupAudioPeer(
    peerId: string,
    options: { preserveFailure?: boolean } = {},
  ) {
    const peer = peerConnectionsRef.current.get(peerId);
    if (peer) {
      peer.close();
      peerConnectionsRef.current.delete(peerId);
    }

    pendingIceCandidatesRef.current.delete(peerId);
    blockedAudioPeersRef.current.delete(peerId);
    if (!options.preserveFailure) {
      failedPeersRef.current.delete(peerId);
    }
    syncMediaError();

    const audio = audioElementsRef.current.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioElementsRef.current.delete(peerId);
    }
  }

  function cleanupAllAudioPeers() {
    const peerIds = new Set([
      ...peerConnectionsRef.current.keys(),
      ...audioElementsRef.current.keys(),
      ...pendingIceCandidatesRef.current.keys(),
    ]);

    for (const peerId of peerIds) {
      cleanupAudioPeer(peerId);
    }

    pendingIceCandidatesRef.current.clear();
  }

  function reconnectEligibleAudioPeers() {
    const selfUserId = selfUserIdRef.current;
    if (!selfUserId || isAfkRef.current) {
      return;
    }

    for (const user of usersRef.current) {
      if (user.id !== selfUserId && !user.isAfk) {
        void createAudioOfferForPeer(user.id);
      }
    }
  }

  async function flushPendingAudioIceCandidates(peerId: string) {
    const peer = peerConnectionsRef.current.get(peerId);
    const pendingCandidates = pendingIceCandidatesRef.current.get(peerId);

    if (!peer || !peer.remoteDescription || !pendingCandidates?.length) {
      return;
    }

    pendingIceCandidatesRef.current.delete(peerId);

    for (const candidate of pendingCandidates) {
      await peer.addIceCandidate(candidate);
    }
  }

  function ensureAudioPeerConnection(peerId: string) {
    const existingPeer = peerConnectionsRef.current.get(peerId);
    if (existingPeer) {
      return existingPeer;
    }

    const peer = new RTCPeerConnection(rtcConfigurationRef.current);
    const localAudio = localAudioRef.current;
    if (localAudio) {
      for (const track of localAudio.outboundStream.getAudioTracks()) {
        peer.addTrack(track, localAudio.outboundStream);
      }
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      sendSignal("audio", peerId, {
        type: "ice-candidate",
        candidate: event.candidate.toJSON(),
      });
    };

    peer.ontrack = (event) => {
      if (event.track.kind !== "audio") {
        return;
      }

      const [stream] = event.streams;
      if (stream) {
        attachRemoteStream(peerId, stream);
        return;
      }

      attachRemoteStream(peerId, new MediaStream([event.track]));
    };

    peer.oniceconnectionstatechange = () => {
      if (peerConnectionsRef.current.get(peerId) !== peer) {
        return;
      }

      if (
        peer.iceConnectionState === "connected" ||
        peer.iceConnectionState === "completed"
      ) {
        clearPeerFailure(peerId);
        return;
      }

      if (peer.iceConnectionState === "failed") {
        markPeerFailure(peerId);
        cleanupAudioPeer(peerId, { preserveFailure: true });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peerConnectionsRef.current.get(peerId) !== peer) {
        return;
      }

      if (peer.connectionState === "connected") {
        clearPeerFailure(peerId);
        return;
      }

      if (peer.connectionState === "failed") {
        markPeerFailure(peerId);
        cleanupAudioPeer(peerId, { preserveFailure: true });
        return;
      }

      if (peer.connectionState === "closed") {
        cleanupAudioPeer(peerId);
      }
    };

    peerConnectionsRef.current.set(peerId, peer);
    return peer;
  }

  async function createAudioOfferForPeer(peerId: string) {
    const selfUserId = selfUserIdRef.current;
    if (!selfUserId || selfUserId.localeCompare(peerId) <= 0) {
      return;
    }

    if (!canCreateAudioConnection(peerId)) {
      cleanupAudioPeer(peerId);
      return;
    }

    const peer = ensureAudioPeerConnection(peerId);
    if (peer.signalingState !== "stable") {
      return;
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    if (!peer.localDescription) {
      return;
    }

    sendSignal("audio", peerId, {
      type: "offer",
      sdp: peer.localDescription.toJSON(),
    });
  }

  async function handleAudioSignal(fromUserId: string, signal: WebRtcSignal) {
    if (isAfkRef.current) {
      clearPeerFailure(fromUserId);
      cleanupAudioPeer(fromUserId);
      return;
    }

    const peer = ensureAudioPeerConnection(fromUserId);

    if (signal.type === "offer") {
      await peer.setRemoteDescription(signal.sdp);
      await flushPendingAudioIceCandidates(fromUserId);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      if (!peer.localDescription) {
        return;
      }

      sendSignal("audio", fromUserId, {
        type: "answer",
        sdp: peer.localDescription.toJSON(),
      });
      return;
    }

    if (signal.type === "answer") {
      if (peer.signalingState === "have-local-offer") {
        await peer.setRemoteDescription(signal.sdp);
        await flushPendingAudioIceCandidates(fromUserId);
      }
      return;
    }

    if (peer.remoteDescription) {
      await peer.addIceCandidate(signal.candidate);
      return;
    }

    const pendingCandidates =
      pendingIceCandidatesRef.current.get(fromUserId) ?? [];
    pendingCandidates.push(signal.candidate);
    pendingIceCandidatesRef.current.set(fromUserId, pendingCandidates);
  }

  function stopLocalScreenCapture() {
    const stream = localScreenStreamRef.current;
    if (!stream) {
      return;
    }

    localScreenStreamRef.current = null;
    for (const track of stream.getTracks()) {
      track.onended = null;
      track.stop();
    }
  }

  function cleanupScreenPeer(peerId: string) {
    const peer = screenPeerConnectionsRef.current.get(peerId);
    if (peer) {
      peer.close();
      screenPeerConnectionsRef.current.delete(peerId);
    }

    pendingScreenIceCandidatesRef.current.delete(peerId);
    if (
      activeScreenShareUserIdRef.current === peerId &&
      activeScreenShareUserIdRef.current !== selfUserIdRef.current
    ) {
      setActiveScreenStreamState(null);
    }
  }

  function cleanupAllScreenPeers() {
    for (const peerId of [...screenPeerConnectionsRef.current.keys()]) {
      cleanupScreenPeer(peerId);
    }

    pendingScreenIceCandidatesRef.current.clear();
  }

  function ensureScreenPeerConnection(peerId: string) {
    const existingPeer = screenPeerConnectionsRef.current.get(peerId);
    if (existingPeer) {
      return existingPeer;
    }

    const peer = new RTCPeerConnection(rtcConfigurationRef.current);
    const localScreenStream = localScreenStreamRef.current;
    if (
      localScreenStream &&
      selfUserIdRef.current &&
      selfUserIdRef.current === activeScreenShareUserIdRef.current
    ) {
      for (const track of localScreenStream.getVideoTracks()) {
        peer.addTrack(track, localScreenStream);
      }
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      sendSignal("screen", peerId, {
        type: "ice-candidate",
        candidate: event.candidate.toJSON(),
      });
    };

    peer.ontrack = (event) => {
      if (event.track.kind !== "video") {
        return;
      }

      if (peerId !== activeScreenShareUserIdRef.current) {
        return;
      }

      const [stream] = event.streams;
      if (stream) {
        setActiveScreenStreamState(stream);
      } else {
        setActiveScreenStreamState(new MediaStream([event.track]));
      }

      setScreenShareError(null);
    };

    const handlePeerFailure = () => {
      if (
        peerId === activeScreenShareUserIdRef.current &&
        activeScreenShareUserIdRef.current !== selfUserIdRef.current
      ) {
        setActiveScreenStreamState(null);
        setScreenShareError(screenShareConnectionFailedMessage);
      }

      cleanupScreenPeer(peerId);
    };

    peer.oniceconnectionstatechange = () => {
      if (screenPeerConnectionsRef.current.get(peerId) !== peer) {
        return;
      }

      if (
        peer.iceConnectionState === "connected" ||
        peer.iceConnectionState === "completed"
      ) {
        if (
          peerId === activeScreenShareUserIdRef.current &&
          activeScreenShareUserIdRef.current !== selfUserIdRef.current
        ) {
          setScreenShareError(null);
        }
        return;
      }

      if (peer.iceConnectionState === "failed") {
        handlePeerFailure();
      }
    };

    peer.onconnectionstatechange = () => {
      if (screenPeerConnectionsRef.current.get(peerId) !== peer) {
        return;
      }

      if (peer.connectionState === "connected") {
        if (
          peerId === activeScreenShareUserIdRef.current &&
          activeScreenShareUserIdRef.current !== selfUserIdRef.current
        ) {
          setScreenShareError(null);
        }
        return;
      }

      if (peer.connectionState === "failed") {
        handlePeerFailure();
        return;
      }

      if (peer.connectionState === "closed") {
        cleanupScreenPeer(peerId);
      }
    };

    screenPeerConnectionsRef.current.set(peerId, peer);
    return peer;
  }

  async function flushPendingScreenIceCandidates(peerId: string) {
    const peer = screenPeerConnectionsRef.current.get(peerId);
    const pendingCandidates = pendingScreenIceCandidatesRef.current.get(peerId);

    if (!peer || !peer.remoteDescription || !pendingCandidates?.length) {
      return;
    }

    pendingScreenIceCandidatesRef.current.delete(peerId);

    for (const candidate of pendingCandidates) {
      await peer.addIceCandidate(candidate);
    }
  }

  async function createScreenOfferForPeer(peerId: string) {
    const selfUserId = selfUserIdRef.current;
    const localScreenStream = localScreenStreamRef.current;
    if (
      !selfUserId ||
      selfUserId === peerId ||
      activeScreenShareUserIdRef.current !== selfUserId ||
      !localScreenStream
    ) {
      return;
    }

    const peer = ensureScreenPeerConnection(peerId);
    if (peer.signalingState !== "stable") {
      return;
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    if (!peer.localDescription) {
      return;
    }

    sendSignal("screen", peerId, {
      type: "offer",
      sdp: peer.localDescription.toJSON(),
    });
  }

  async function handleScreenSignal(fromUserId: string, signal: WebRtcSignal) {
    const selfUserId = selfUserIdRef.current;
    const activePresenterId = activeScreenShareUserIdRef.current;
    const isSelfPresenter = Boolean(
      selfUserId && activePresenterId === selfUserId,
    );

    if (signal.type === "offer") {
      if (isSelfPresenter || fromUserId !== activePresenterId) {
        return;
      }

      const peer = ensureScreenPeerConnection(fromUserId);
      await peer.setRemoteDescription(signal.sdp);
      await flushPendingScreenIceCandidates(fromUserId);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      if (!peer.localDescription) {
        return;
      }

      sendSignal("screen", fromUserId, {
        type: "answer",
        sdp: peer.localDescription.toJSON(),
      });
      return;
    }

    if (signal.type === "answer") {
      if (!isSelfPresenter) {
        return;
      }

      const peer = ensureScreenPeerConnection(fromUserId);
      if (peer.signalingState === "have-local-offer") {
        await peer.setRemoteDescription(signal.sdp);
        await flushPendingScreenIceCandidates(fromUserId);
      }
      return;
    }

    if (!isSelfPresenter && fromUserId !== activePresenterId) {
      return;
    }

    const peer = ensureScreenPeerConnection(fromUserId);
    if (peer.remoteDescription) {
      await peer.addIceCandidate(signal.candidate);
      return;
    }

    const pendingCandidates =
      pendingScreenIceCandidatesRef.current.get(fromUserId) ?? [];
    pendingCandidates.push(signal.candidate);
    pendingScreenIceCandidatesRef.current.set(fromUserId, pendingCandidates);
  }

  function applyActiveScreenShareUpdate(
    nextUserId: string | null,
    options: { emitSound?: boolean } = {},
  ) {
    const emitSound = options.emitSound ?? true;
    const previousUserId = activeScreenShareUserIdRef.current;
    const screenShareNotificationCue = emitSound
      ? getScreenShareNotificationCue(previousUserId, nextUserId)
      : null;
    activeScreenShareUserIdRef.current = nextUserId;
    setActiveScreenShareUserId(nextUserId);

    const selfUserId = selfUserIdRef.current;
    if (screenShareNotificationCue) {
      playNotificationCue(screenShareNotificationCue);
    }

    if (previousUserId === nextUserId) {
      if (nextUserId === selfUserId && localScreenStreamRef.current) {
        setActiveScreenStreamState(localScreenStreamRef.current);
        setScreenShareStatusState(ScreenShareStatus.Sharing);
        setScreenShareError(null);
      }
      return;
    }

    cleanupAllScreenPeers();
    setActiveScreenStreamState(null);

    const idleStatus = getInitialScreenShareStatus();
    if (previousUserId === selfUserId && nextUserId !== selfUserId) {
      stopLocalScreenCapture();
      setScreenShareStatusState(idleStatus);
      setScreenShareError(null);

      const nextPresenterName = getUserName(nextUserId);
      setScreenShareNotice(
        nextPresenterName ? `${nextPresenterName} took over screen sharing.` : null,
      );
      return;
    }

    if (nextUserId === selfUserId) {
      const localScreenStream = localScreenStreamRef.current;
      setScreenShareNotice(null);
      if (!localScreenStream) {
        setScreenShareStatusState(idleStatus);
        setScreenShareError(null);
        sendEvent({
          type: "screen-share:stop",
        });
        return;
      }

      setActiveScreenStreamState(localScreenStream);
      setScreenShareStatusState(ScreenShareStatus.Sharing);
      setScreenShareError(null);
      for (const user of usersRef.current) {
        if (user.id !== selfUserId) {
          void createScreenOfferForPeer(user.id);
        }
      }
      return;
    }

    setScreenShareStatusState(idleStatus);
    setScreenShareError(null);
    setScreenShareNotice(null);
  }

  async function handleServerEvent(event: ServerEvent) {
    if (event.type === "room:snapshot") {
      selfUserIdRef.current = event.selfUserId;
      rtcConfigurationRef.current = event.rtcConfiguration as RTCConfiguration;
      hasTurnRelayRef.current = hasTurnRelay(rtcConfigurationRef.current);
      const selfPresence = createPresenceState();
      setUsersState(
        sortUsers(
          event.users.map((user) =>
            user.id === event.selfUserId
              ? {
                  ...user,
                  isAfk: selfPresence.isAfk,
                  isMuted: selfPresence.isMuted,
                  isSpeaking: selfPresence.isSpeaking,
                }
              : user,
          ),
        ),
      );
      applyActiveScreenShareUpdate(event.activeScreenShareUserId, {
        emitSound: false,
      });

      for (const user of event.users) {
        if (user.id !== event.selfUserId && !user.isAfk) {
          void createAudioOfferForPeer(user.id);
        }
      }

      return;
    }

    if (event.type === "room:user-joined") {
      updateUser(event.user);
      playNotificationCue("join");
      if (event.user.id !== selfUserIdRef.current) {
        void createAudioOfferForPeer(event.user.id);
        if (selfUserIdRef.current === activeScreenShareUserIdRef.current) {
          void createScreenOfferForPeer(event.user.id);
        }
      }
      return;
    }

    if (event.type === "room:user-updated") {
      const previousUser = getUser(event.user.id);
      updateUser(event.user);

      if (previousUser && !previousUser.isAfk && event.user.isAfk) {
        playNotificationCue("afk");
      }

      if (event.user.id === selfUserIdRef.current) {
        if (previousUser?.isAfk && !event.user.isAfk) {
          reconnectEligibleAudioPeers();
        }
        return;
      }

      if (event.user.isAfk) {
        clearPeerFailure(event.user.id);
        cleanupAudioPeer(event.user.id);
        return;
      }

      if (!previousUser || previousUser.isAfk) {
        void createAudioOfferForPeer(event.user.id);
      }
      return;
    }

    if (event.type === "room:screen-share-updated") {
      applyActiveScreenShareUpdate(event.activeScreenShareUserId);
      return;
    }

    if (event.type === "room:user-left") {
      clearPeerFailure(event.userId);
      cleanupAudioPeer(event.userId);
      cleanupScreenPeer(event.userId);
      removeUser(event.userId);

      if (event.userId === activeScreenShareUserIdRef.current) {
        applyActiveScreenShareUpdate(null);
      }
      playNotificationCue("leave");
      return;
    }

    if (event.type === "signal") {
      try {
        if (event.channel === "audio") {
          await handleAudioSignal(event.fromUserId, event.signal);
        } else {
          await handleScreenSignal(event.fromUserId, event.signal);
        }
      } catch {
        if (event.channel === "audio") {
          setConnectionError("Peer connection renegotiation failed.");
        } else {
          cleanupScreenPeer(event.fromUserId);
          setScreenShareError("Screen share negotiation failed.");
        }
      }
      return;
    }

    setConnectionError(event.message);
  }

  function stopSpeechDetection() {
    if (speechFrameRef.current) {
      cancelAnimationFrame(speechFrameRef.current);
      speechFrameRef.current = null;
    }
  }

  function startSpeechDetection(analyser: AnalyserNode | null) {
    if (!analyser) {
      return;
    }

    const samples = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(samples);

      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / samples.length);
      const nextSpeaking = !isMutedRef.current && rms > 0.03;

      if (nextSpeaking !== speakingRef.current) {
        speakingRef.current = nextSpeaking;
        syncPresence(createPresenceState({ isSpeaking: nextSpeaking }));
      }

      speechFrameRef.current = requestAnimationFrame(tick);
    };

    speechFrameRef.current = requestAnimationFrame(tick);
  }

  function clearReconnectTimeout() {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }

  function resetRealtimeState() {
    cleanupAllAudioPeers();

    cleanupAllScreenPeers();
    stopLocalScreenCapture();
    setActiveScreenStreamState(null);

    const selfUserId = selfUserIdRef.current;
    setUsersState(
      selfUserId
        ? usersRef.current.filter((user) => user.id === selfUserId)
        : [],
    );
    activeScreenShareUserIdRef.current = null;
    setActiveScreenShareUserId(null);
    pendingIceCandidatesRef.current.clear();
    pendingScreenIceCandidatesRef.current.clear();
    blockedAudioPeersRef.current.clear();
    failedPeersRef.current.clear();
    setMediaError(null);
    setScreenShareError(null);
    setScreenShareNotice(null);
    setScreenShareStatusState(getInitialScreenShareStatus());
  }

  function teardownRoomConnection() {
    clearReconnectTimeout();
    stopSpeechDetection();
    resetRealtimeState();

    const localAudio = localAudioRef.current;
    if (localAudio) {
      localAudio.destroy();
      localAudioRef.current = null;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close(1000, "Room closed");
    }
    wsRef.current = null;
    selfUserIdRef.current = null;
    speakingRef.current = false;
    setMediaError(null);
    setLocalCaptureError(null);
    setAudioProcessingMode("standard");
    setAudioProcessingReason("unsupported");
    setScreenShareError(null);
    setScreenShareNotice(null);
    setScreenShareStatusState(getInitialScreenShareStatus());
  }

  useEffect(() => {
    let isActive = true;
    manualDisconnectRef.current = false;

    function stopReconnectingWithMessage(message: string) {
      clearReconnectTimeout();
      reconnectAttemptsRef.current = 0;
      resetRealtimeState();
      setConnectionState(ConnectionState.Disconnected);
      setConnectionError(message);
    }

    function scheduleReconnect() {
      if (!isActive || manualDisconnectRef.current) {
        return;
      }

      clearReconnectTimeout();
      reconnectAttemptsRef.current += 1;
      const reconnectDelayMs = Math.min(
        1_000 * reconnectAttemptsRef.current,
        5_000,
      );

      setConnectionState(ConnectionState.Reconnecting);
      setConnectionError(realtimeReconnectingMessage);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        void connectToRealtime();
      }, reconnectDelayMs);
    }

    function handleUnexpectedSocketClose(
      ws: WebSocket,
      event: CloseEvent,
    ) {
      if (!isActive || manualDisconnectRef.current || wsRef.current !== ws) {
        return;
      }

      wsRef.current = null;

      if (event.code === 4000 || event.code === 4002) {
        stopReconnectingWithMessage(sessionTakenOverMessage);
        return;
      }

      if (event.code === 4003 || event.code === 4004) {
        stopReconnectingWithMessage(sessionUnavailableMessage);
        return;
      }

      resetRealtimeState();
      scheduleReconnect();
    }

    function connectToRealtime() {
      if (!isActive || manualDisconnectRef.current) {
        return;
      }

      clearReconnectTimeout();
      setConnectionState(
        reconnectAttemptsRef.current > 0 ? ConnectionState.Reconnecting : ConnectionState.Connecting,
      );
      if (reconnectAttemptsRef.current === 0) {
        setConnectionError(null);
      }

      const ws = new WebSocket(buildWebSocketUrl("/api/ws"));
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (!isActive || wsRef.current !== ws) {
          return;
        }

        reconnectAttemptsRef.current = 0;
        setConnectionState(ConnectionState.Connected);
        setConnectionError(null);
        syncPresence(createPresenceState());
      });

      ws.addEventListener("message", (event) => {
        if (wsRef.current !== ws || typeof event.data !== "string") {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as ServerEvent;
          void handleServerEvent(payload);
        } catch {
          setConnectionError("Unexpected realtime payload.");
        }
      });

      ws.addEventListener("error", () => {
        if (!isActive || wsRef.current !== ws) {
          return;
        }

        if (ws.readyState === WebSocket.CLOSED) {
          return;
        }

        setConnectionError(realtimeReconnectingMessage);
      });

      ws.addEventListener("close", (event) => {
        handleUnexpectedSocketClose(ws, event);
      });
    }

    async function connect() {
      try {
        setConnectionState(ConnectionState.RequestingMedia);
        setConnectionError(null);
        setLocalCaptureError(null);
        setMediaError(null);
        setMicrophoneDeviceError(null);
        setSpeakerDeviceError(
          initialSpeakerSelectionSupported
            ? null
            : speakerSelectionUnsupportedMessage,
        );
        setAudioProcessingMode("standard");
        setAudioProcessingReason("unsupported");
        setScreenShareError(null);
        setScreenShareNotice(null);
        setScreenShareStatusState(getInitialScreenShareStatus());
        hasTurnRelayRef.current = false;
        setAudioDevicesLoading(true);

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(getMicrophoneUnavailableMessage());
        }

        const requestedMicrophoneId = selectedMicrophoneIdRef.current;
        let localAudio: PreparedLocalAudio;

        try {
          localAudio = await createPreparedLocalAudio(requestedMicrophoneId);
        } catch (cause) {
          if (!requestedMicrophoneId || !isMissingDeviceError(cause)) {
            throw cause;
          }

          setSelectedMicrophoneIdState("");
          writeStoredAudioDeviceId(
            appConfig.storage.microphoneDeviceIdKey,
            "",
          );
          localAudio = await createPreparedLocalAudio("");
        }

        if (!isActive) {
          localAudio.destroy();
          return;
        }

        localAudioRef.current = localAudio;
        resumeNotificationAudio();
        await setEffectiveMutedState(getEffectiveMuted());
        startSpeechDetection(localAudio.analyser);
        await refreshAudioDevices();
        connectToRealtime();
      } catch (cause) {
        if (!isActive) {
          return;
        }

        setConnectionState(ConnectionState.Disconnected);
        setConnectionError(
          cause instanceof Error
            ? cause.message
            : "Microphone access is required to join the room.",
        );
      } finally {
        if (isActive) {
          setAudioDevicesLoading(false);
        }
      }
    }

    void connect();

    return () => {
      isActive = false;
      manualDisconnectRef.current = true;
      teardownRoomConnection();
    };
  }, []);

  useEffect(() => {
    if (!initialSpeakerSelectionSupported) {
      writeStoredAudioDeviceId(appConfig.storage.speakerDeviceIdKey, "");
    }

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshAudioDevices();
    };

    mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    const handleUserInteraction = () => {
      resumeNotificationAudio();
      queueMicrotask(() => {
        retryBlockedAudioPlayback();
      });
    };

    window.addEventListener("click", handleUserInteraction, true);
    window.addEventListener("keydown", handleUserInteraction, true);

    return () => {
      window.removeEventListener("click", handleUserInteraction, true);
      window.removeEventListener("keydown", handleUserInteraction, true);
    };
  }, []);

  async function toggleMute() {
    if (isAfkRef.current) {
      return;
    }

    const previousManualMuted = manualMutedRef.current;
    const nextManualMuted = !manualMutedRef.current;
    manualMutedRef.current = nextManualMuted;
    const nextMuted = getEffectiveMuted({ manualMuted: nextManualMuted });

    try {
      await setEffectiveMutedState(nextMuted);
    } catch (cause) {
      manualMutedRef.current = previousManualMuted;
      await restoreMutedStateAfterResumeFailure(cause);
      syncPresence(createPresenceState({ isMuted: true, isSpeaking: false }));
      return;
    }

    playNotificationCue(nextMuted ? "mute" : "unmute");

    if (nextMuted && speakingRef.current) {
      speakingRef.current = false;
      syncPresence(createPresenceState({ isMuted: nextMuted, isSpeaking: false }));
      return;
    }

    syncPresence(createPresenceState({ isMuted: nextMuted }));
  }

  async function toggleAfk() {
    const nextAfk = !isAfkRef.current;
    isAfkRef.current = nextAfk;
    setIsAfk(nextAfk);
    setScreenShareError((previousError) =>
      previousError === screenShareAfkMessage ? null : previousError,
    );

    const nextMuted = getEffectiveMuted({ isAfk: nextAfk });
    try {
      await setEffectiveMutedState(nextMuted);
    } catch (cause) {
      await restoreMutedStateAfterResumeFailure(cause);
    }

    if (nextAfk) {
      playNotificationCue("afk");
    }

    if (nextAfk) {
      speakingRef.current = false;
      syncPresence(
        createPresenceState({
          isAfk: true,
          isMuted: true,
          isSpeaking: false,
        }),
      );
      if (activeScreenShareUserIdRef.current === selfUserIdRef.current) {
        stopScreenShare();
      }
      cleanupAllAudioPeers();
      return;
    }

    syncPresence(
      createPresenceState({
        isAfk: false,
        isMuted: isMutedRef.current,
        isSpeaking: isMutedRef.current ? false : speakingRef.current,
      }),
    );
    reconnectEligibleAudioPeers();
  }

  async function startScreenShare() {
    if (
      screenShareStatusRef.current === ScreenShareStatus.Requesting ||
      screenShareStatusRef.current === ScreenShareStatus.Starting ||
      screenShareStatusRef.current === ScreenShareStatus.Sharing ||
      screenShareStatusRef.current === ScreenShareStatus.Stopping
    ) {
      return;
    }

    if (!supportsScreenShare()) {
      setScreenShareStatusState(ScreenShareStatus.Unsupported);
      setScreenShareError(screenShareUnavailableMessage);
      return;
    }

    if (isAfkRef.current) {
      setScreenShareNotice(null);
      setScreenShareError(screenShareAfkMessage);
      return;
    }

    if (
      connectionState === ConnectionState.Disconnected ||
      !selfUserIdRef.current ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      setScreenShareError(screenShareNotReadyMessage);
      return;
    }

    setScreenShareNotice(null);
    setScreenShareError(null);
    setScreenShareStatusState(ScreenShareStatus.Requesting);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15, max: 15 },
        },
      });

      const [track] = stream.getVideoTracks();
      if (!track) {
        for (const streamTrack of stream.getTracks()) {
          streamTrack.stop();
        }
        setScreenShareStatusState(getInitialScreenShareStatus());
        setScreenShareError(screenShareFailedMessage);
        return;
      }

      stopLocalScreenCapture();
      if ("contentHint" in track) {
        track.contentHint = "detail";
      }
      track.onended = () => {
        stopScreenShare();
      };

      localScreenStreamRef.current = stream;
      setScreenShareStatusState(ScreenShareStatus.Starting);
      sendEvent({
        type: "screen-share:start",
      });
    } catch (cause) {
      setScreenShareStatusState(getInitialScreenShareStatus());
      if (
        cause instanceof DOMException &&
        (cause.name === "AbortError" || cause.name === "NotAllowedError")
      ) {
        setScreenShareError(screenShareCancelledMessage);
      } else {
        setScreenShareError(screenShareFailedMessage);
      }
    }
  }

  function stopScreenShare(options: { notifyServer?: boolean } = {}) {
    const notifyServer = options.notifyServer ?? true;
    const selfUserId = selfUserIdRef.current;
    const wasActivePresenter = Boolean(
      selfUserId && activeScreenShareUserIdRef.current === selfUserId,
    );
    const hadLocalScreen = Boolean(localScreenStreamRef.current);

    if (!hadLocalScreen && !wasActivePresenter) {
      setScreenShareStatusState(getInitialScreenShareStatus());
      setScreenShareNotice(null);
      return;
    }

    if (notifyServer && wasActivePresenter) {
      setScreenShareStatusState(ScreenShareStatus.Stopping);
    } else {
      setScreenShareStatusState(getInitialScreenShareStatus());
    }

    stopLocalScreenCapture();
    cleanupAllScreenPeers();
    setActiveScreenStreamState(null);
    setScreenShareError(null);
    setScreenShareNotice(null);

    if (notifyServer && wasActivePresenter) {
      sendEvent({
        type: "screen-share:stop",
      });
    }
  }

  function disconnect() {
    playNotificationCue("leave");
    manualDisconnectRef.current = true;
    teardownRoomConnection();
    setUsersState([]);
    setConnectionState(ConnectionState.Disconnected);
  }

  return {
    users,
    selfUserId: selfUserIdRef.current,
    isMuted,
    isAfk,
    connectionState,
    error: connectionError ?? localCaptureError ?? mediaError,
    audioProcessingMode,
    audioProcessingReason,
    activeScreenShareUserId,
    activeScreenStream,
    screenShareStatus,
    screenShareError,
    screenShareNotice,
    audioDevices,
    selectedMicrophoneId,
    selectedSpeakerId,
    audioDeviceStatus: {
      isLoading: audioDevicesLoading,
      microphoneError: microphoneDeviceError,
      speakerError: speakerDeviceError,
      speakerSelectionSupported: initialSpeakerSelectionSupported,
    },
    refreshAudioDevices,
    selectMicrophone,
    selectSpeaker,
    toggleMute,
    toggleAfk,
    startScreenShare,
    stopScreenShare,
    disconnect,
  };
}
