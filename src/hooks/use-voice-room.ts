import { useEffect, useRef, useState } from "react";
import type {
  ClientEvent,
  RoomUser,
  ServerEvent,
  WebRtcSignal,
} from "@/lib/protocol";

type ConnectionState =
  | "requesting-media"
  | "connecting"
  | "connected"
  | "disconnected";

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

export function useVoiceRoom() {
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("requesting-media");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const selfUserIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceCandidatesRef = useRef(
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

  function sendEvent(event: ClientEvent) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(event));
  }

  function updateUser(user: RoomUser) {
    setUsers((previousUsers) => {
      const nextUsers = previousUsers.filter(
        (existingUser) => existingUser.id !== user.id,
      );
      nextUsers.push(user);
      return sortUsers(nextUsers);
    });
  }

  function removeUser(userId: string) {
    setUsers((previousUsers) =>
      previousUsers.filter((user) => user.id !== userId),
    );
  }

  function syncPresence(nextMuted: boolean, nextSpeaking: boolean) {
    const selfUserId = selfUserIdRef.current;
    if (selfUserId) {
      setUsers((previousUsers) =>
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

  function cleanupPeer(
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

  async function flushPendingIceCandidates(peerId: string) {
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

  function ensurePeerConnection(peerId: string) {
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

      sendEvent({
        type: "signal",
        targetUserId: peerId,
        signal: {
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        },
      });
    };

    peer.ontrack = (event) => {
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
        cleanupPeer(peerId, { preserveFailure: true });
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
        cleanupPeer(peerId, { preserveFailure: true });
        return;
      }

      if (peer.connectionState === "closed") {
        cleanupPeer(peerId);
      }
    };

    peerConnectionsRef.current.set(peerId, peer);
    return peer;
  }

  async function createOfferForPeer(peerId: string) {
    const selfUserId = selfUserIdRef.current;
    if (!selfUserId || selfUserId.localeCompare(peerId) <= 0) {
      return;
    }

    const peer = ensurePeerConnection(peerId);
    if (peer.signalingState !== "stable") {
      return;
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    if (!peer.localDescription) {
      return;
    }

    sendEvent({
      type: "signal",
      targetUserId: peerId,
      signal: {
        type: "offer",
        sdp: peer.localDescription.toJSON(),
      },
    });
  }

  async function handleSignal(fromUserId: string, signal: WebRtcSignal) {
    const peer = ensurePeerConnection(fromUserId);

    if (signal.type === "offer") {
      await peer.setRemoteDescription(signal.sdp);
      await flushPendingIceCandidates(fromUserId);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      if (!peer.localDescription) {
        return;
      }

      sendEvent({
        type: "signal",
        targetUserId: fromUserId,
        signal: {
          type: "answer",
          sdp: peer.localDescription.toJSON(),
        },
      });
      return;
    }

    if (signal.type === "answer") {
      if (peer.signalingState === "have-local-offer") {
        await peer.setRemoteDescription(signal.sdp);
        await flushPendingIceCandidates(fromUserId);
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

  async function handleServerEvent(event: ServerEvent) {
    if (event.type === "room:snapshot") {
      selfUserIdRef.current = event.selfUserId;
      rtcConfigurationRef.current = event.rtcConfiguration as RTCConfiguration;
      hasTurnRelayRef.current = hasTurnRelay(rtcConfigurationRef.current);
      setUsers(sortUsers(event.users));

      for (const user of event.users) {
        if (user.id !== event.selfUserId) {
          void createOfferForPeer(user.id);
        }
      }

      return;
    }

    if (event.type === "room:user-joined") {
      updateUser(event.user);
      if (event.user.id !== selfUserIdRef.current) {
        void createOfferForPeer(event.user.id);
      }
      return;
    }

    if (event.type === "room:user-updated") {
      updateUser(event.user);
      return;
    }

    if (event.type === "room:user-left") {
      clearPeerFailure(event.userId);
      cleanupPeer(event.userId);
      removeUser(event.userId);
      return;
    }

    if (event.type === "signal") {
      try {
        await handleSignal(event.fromUserId, event.signal);
      } catch {
        setConnectionError("Peer connection renegotiation failed.");
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
      cleanupPeer(peerId);
    }

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
    pendingIceCandidatesRef.current.clear();
    speakingRef.current = false;
    blockedAudioPeersRef.current.clear();
    failedPeersRef.current.clear();
    setMediaError(null);
  }

  useEffect(() => {
    let isActive = true;
    manualDisconnectRef.current = false;

    async function connect() {
      try {
        setConnectionState("requesting-media");
        setConnectionError(null);
        setMediaError(null);
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

  function disconnect() {
    manualDisconnectRef.current = true;
    teardownRoomConnection();
    setUsers([]);
    setConnectionState("disconnected");
  }

  return {
    users,
    selfUserId: selfUserIdRef.current,
    isMuted,
    connectionState,
    error: connectionError ?? mediaError,
    toggleMute,
    disconnect,
  };
}
