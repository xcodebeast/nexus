import { useEffect, useRef, useState } from "react";
import type {
  ClientEvent,
  RoomUser,
  ServerEvent,
  SignalChannel,
  WebRtcSignal,
} from "@/lib/protocol";

type ConnectionState =
  | "requesting-media"
  | "connecting"
  | "connected"
  | "disconnected";

type ScreenShareStatus =
  | "unsupported"
  | "idle"
  | "requesting"
  | "starting"
  | "sharing"
  | "stopping";

function buildWebSocketUrl(pathname: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}

function sortUsers(users: RoomUser[]) {
  return [...users].sort((left, right) => left.connectedAt - right.connectedAt);
}

function hasTurnRelay(rtcConfiguration: RTCConfiguration) {
  return (rtcConfiguration.iceServers ?? []).some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(
      (url) => typeof url === "string" && /^(turn|turns):/i.test(url),
    );
  });
}

function getRemotePlaybackBlockedMessage() {
  return "Remote audio is waiting for a browser interaction. Click anywhere or use a control to resume playback.";
}

function getPeerConnectionFailedMessage(hasTurnRelayConfigured: boolean) {
  if (!hasTurnRelayConfigured) {
    return "Peer audio connection failed. TURN relay is not configured, so callers on different networks may not hear each other.";
  }

  return "Peer audio connection failed. Check network access and reconnect.";
}

function getMicrophoneUnavailableMessage() {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (!window.isSecureContext && !isLocalhost) {
    return "Microphone access requires HTTPS or localhost.";
  }

  return "Microphone access is unavailable in this browser.";
}

function supportsScreenShare() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function getInitialScreenShareStatus(): ScreenShareStatus {
  if (typeof navigator === "undefined") {
    return "idle";
  }

  return supportsScreenShare() ? "idle" : "unsupported";
}

function getScreenShareUnavailableMessage() {
  return "Screen sharing is available in desktop Chromium browsers with display capture support.";
}

function getScreenShareCancelledMessage() {
  return "Screen sharing was cancelled before it started.";
}

function getScreenShareFailedMessage() {
  return "Screen sharing could not start. Try again.";
}

function getScreenShareConnectionFailedMessage() {
  return "Screen share connection failed. Ask the presenter to restart sharing.";
}

function getScreenShareNotReadyMessage() {
  return "Realtime connection is not ready for screen sharing yet.";
}

export function useVoiceRoom() {
  const initialScreenShareStatus = getInitialScreenShareStatus();
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("requesting-media");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
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

  const wsRef = useRef<WebSocket | null>(null);
  const selfUserIdRef = useRef<string | null>(null);
  const usersRef = useRef<RoomUser[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const speechFrameRef = useRef<number | null>(null);
  const manualDisconnectRef = useRef(false);
  const isMutedRef = useRef(false);
  const speakingRef = useRef(false);
  const hasTurnRelayRef = useRef(false);
  const failedPeersRef = useRef(new Set<string>());
  const blockedAudioPeersRef = useRef(new Set<string>());
  const activeScreenShareUserIdRef = useRef<string | null>(null);
  const screenShareStatusRef =
    useRef<ScreenShareStatus>(initialScreenShareStatus);
  const activeScreenStreamRef = useRef<MediaStream | null>(null);

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

  function syncPresence(nextMuted: boolean, nextSpeaking: boolean) {
    const selfUserId = selfUserIdRef.current;
    if (selfUserId) {
      setUsersWithUpdater((previousUsers) =>
        previousUsers.map((user) =>
          user.id === selfUserId
            ? {
                ...user,
                isMuted: nextMuted,
                isSpeaking: nextMuted ? false : nextSpeaking,
              }
            : user,
        ),
      );
    }

    sendEvent({
      type: "presence:update",
      isMuted: nextMuted,
      isSpeaking: nextMuted ? false : nextSpeaking,
    });
  }

  function setTrackMute(nextMuted: boolean) {
    isMutedRef.current = nextMuted;
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }

    for (const track of stream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }
  }

  function syncMediaError() {
    if (blockedAudioPeersRef.current.size > 0) {
      setMediaError(getRemotePlaybackBlockedMessage());
      return;
    }

    if (failedPeersRef.current.size > 0) {
      setMediaError(getPeerConnectionFailedMessage(hasTurnRelayRef.current));
      return;
    }

    setMediaError(null);
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

  function attachRemoteStream(peerId: string, stream: MediaStream) {
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
    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) {
        peer.addTrack(track, localStream);
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
        setScreenShareError(getScreenShareConnectionFailedMessage());
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

  function applyActiveScreenShareUpdate(nextUserId: string | null) {
    const previousUserId = activeScreenShareUserIdRef.current;
    activeScreenShareUserIdRef.current = nextUserId;
    setActiveScreenShareUserId(nextUserId);

    const selfUserId = selfUserIdRef.current;
    if (previousUserId === nextUserId) {
      if (nextUserId === selfUserId && localScreenStreamRef.current) {
        setActiveScreenStreamState(localScreenStreamRef.current);
        setScreenShareStatusState("sharing");
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
      setScreenShareStatusState("sharing");
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
      setUsersState(sortUsers(event.users));
      applyActiveScreenShareUpdate(event.activeScreenShareUserId);

      for (const user of event.users) {
        if (user.id !== event.selfUserId) {
          void createAudioOfferForPeer(user.id);
        }
      }

      return;
    }

    if (event.type === "room:user-joined") {
      updateUser(event.user);
      if (event.user.id !== selfUserIdRef.current) {
        void createAudioOfferForPeer(event.user.id);
        if (selfUserIdRef.current === activeScreenShareUserIdRef.current) {
          void createScreenOfferForPeer(event.user.id);
        }
      }
      return;
    }

    if (event.type === "room:user-updated") {
      updateUser(event.user);
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

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function startSpeechDetection(stream: MediaStream) {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

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
        syncPresence(isMutedRef.current, nextSpeaking);
      }

      speechFrameRef.current = requestAnimationFrame(tick);
    };

    audioContextRef.current = audioContext;
    speechFrameRef.current = requestAnimationFrame(tick);
  }

  function teardownRoomConnection() {
    stopSpeechDetection();

    for (const peerId of [...peerConnectionsRef.current.keys()]) {
      cleanupAudioPeer(peerId);
    }

    cleanupAllScreenPeers();
    stopLocalScreenCapture();
    setActiveScreenStreamState(null);

    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close(1000, "Room closed");
    }
    wsRef.current = null;
    selfUserIdRef.current = null;
    activeScreenShareUserIdRef.current = null;
    setActiveScreenShareUserId(null);
    pendingIceCandidatesRef.current.clear();
    pendingScreenIceCandidatesRef.current.clear();
    speakingRef.current = false;
    blockedAudioPeersRef.current.clear();
    failedPeersRef.current.clear();
    setMediaError(null);
    setScreenShareError(null);
    setScreenShareNotice(null);
    setScreenShareStatusState(getInitialScreenShareStatus());
  }

  useEffect(() => {
    let isActive = true;
    manualDisconnectRef.current = false;

    async function connect() {
      try {
        setConnectionState("requesting-media");
        setConnectionError(null);
        setMediaError(null);
        setScreenShareError(null);
        setScreenShareNotice(null);
        setScreenShareStatusState(getInitialScreenShareStatus());
        hasTurnRelayRef.current = false;

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(getMicrophoneUnavailableMessage());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        if (!isActive) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        localStreamRef.current = stream;
        setTrackMute(isMutedRef.current);
        startSpeechDetection(stream);
        setConnectionState("connecting");

        const ws = new WebSocket(buildWebSocketUrl("/api/ws"));
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          if (!isActive) {
            return;
          }

          setConnectionState("connected");
          syncPresence(isMutedRef.current, speakingRef.current);
        });

        ws.addEventListener("message", (event) => {
          if (typeof event.data !== "string") {
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
          if (isActive) {
            setConnectionError("Realtime connection failed.");
          }
        });

        ws.addEventListener("close", () => {
          if (!isActive || manualDisconnectRef.current) {
            return;
          }

          setConnectionState("disconnected");
          setConnectionError("Realtime connection lost.");
        });
      } catch (cause) {
        if (!isActive) {
          return;
        }

        setConnectionState("disconnected");
        setConnectionError(
          cause instanceof Error
            ? cause.message
            : "Microphone access is required to join the room.",
        );
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
    const handleUserInteraction = () => {
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

  function toggleMute() {
    const nextMuted = !isMutedRef.current;
    setIsMuted(nextMuted);
    setTrackMute(nextMuted);

    if (nextMuted && speakingRef.current) {
      speakingRef.current = false;
      syncPresence(nextMuted, false);
      return;
    }

    syncPresence(nextMuted, speakingRef.current);
  }

  async function startScreenShare() {
    if (
      screenShareStatusRef.current === "requesting" ||
      screenShareStatusRef.current === "starting" ||
      screenShareStatusRef.current === "sharing" ||
      screenShareStatusRef.current === "stopping"
    ) {
      return;
    }

    if (!supportsScreenShare()) {
      setScreenShareStatusState("unsupported");
      setScreenShareError(getScreenShareUnavailableMessage());
      return;
    }

    if (
      connectionState === "disconnected" ||
      !selfUserIdRef.current ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      setScreenShareError(getScreenShareNotReadyMessage());
      return;
    }

    setScreenShareNotice(null);
    setScreenShareError(null);
    setScreenShareStatusState("requesting");

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
        setScreenShareError(getScreenShareFailedMessage());
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
      setScreenShareStatusState("starting");
      sendEvent({
        type: "screen-share:start",
      });
    } catch (cause) {
      setScreenShareStatusState(getInitialScreenShareStatus());
      if (
        cause instanceof DOMException &&
        (cause.name === "AbortError" || cause.name === "NotAllowedError")
      ) {
        setScreenShareError(getScreenShareCancelledMessage());
      } else {
        setScreenShareError(getScreenShareFailedMessage());
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
      setScreenShareStatusState("stopping");
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
    manualDisconnectRef.current = true;
    teardownRoomConnection();
    setUsersState([]);
    setConnectionState("disconnected");
  }

  return {
    users,
    selfUserId: selfUserIdRef.current,
    isMuted,
    connectionState,
    error: connectionError ?? mediaError,
    activeScreenShareUserId,
    activeScreenStream,
    screenShareStatus,
    screenShareError,
    screenShareNotice,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    disconnect,
  };
}
