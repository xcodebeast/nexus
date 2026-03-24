import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js" with { type: "file" };
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm" with { type: "file" };
import rnnoiseSimdWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm" with { type: "file" };

export type AudioProcessingMode = "enhanced" | "standard";

export type AudioProcessingReason =
  | "active"
  | "unsupported"
  | "init-failed"
  | "runtime-fallback";

export interface AudioProcessingState {
  mode: AudioProcessingMode;
  reason: AudioProcessingReason;
}

export interface PreparedLocalAudio {
  outboundStream: MediaStream;
  analyser: AnalyserNode | null;
  setMuted: (nextMuted: boolean) => Promise<void>;
  destroy: () => void;
}

interface PrepareLocalAudioOptions {
  deviceId?: string | null;
  onStateChange?: (state: AudioProcessingState) => void;
}

type RnnoiseNode = AudioWorkletNode & {
  destroy: () => void;
};

type WebNoiseSuppressor = typeof import("@sapphi-red/web-noise-suppressor");

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function disconnectNode(node: AudioNode | null) {
  if (!node) {
    return;
  }

  try {
    node.disconnect();
  } catch {
    // Disconnection can race with teardown and is safe to ignore.
  }
}

function buildMicrophoneConstraints(
  deviceId?: string | null,
): MediaTrackConstraints {
  const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
  const constraints: MediaTrackConstraints = {};

  if (supportedConstraints.autoGainControl) {
    constraints.autoGainControl = true;
  }

  if (supportedConstraints.echoCancellation) {
    constraints.echoCancellation = true;
  }

  if (supportedConstraints.noiseSuppression) {
    constraints.noiseSuppression = true;
  }

  if (supportedConstraints.channelCount) {
    constraints.channelCount = { ideal: 1 };
  }

  if (supportedConstraints.sampleRate) {
    constraints.sampleRate = { ideal: 48_000 };
  }

  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
}

export async function prepareLocalAudio({
  deviceId,
  onStateChange,
}: PrepareLocalAudioOptions = {}): Promise<PreparedLocalAudio> {
  const microphoneConstraints = buildMicrophoneConstraints(deviceId);
  let rawStream: MediaStream | null = await navigator.mediaDevices.getUserMedia({
    audio: microphoneConstraints,
  });

  let currentState: AudioProcessingState = {
    mode: "standard",
    reason: "unsupported",
  };

  const updateState = (state: AudioProcessingState) => {
    if (
      currentState.mode === state.mode &&
      currentState.reason === state.reason
    ) {
      return;
    }

    currentState = state;
    onStateChange?.(state);
  };

  let outboundStream = rawStream;
  const setOutboundTrackEnabled = (enabled: boolean) => {
    for (const track of outboundStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  };

  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) {
    onStateChange?.(currentState);

    return {
      outboundStream,
      analyser: null,
      setMuted: async (nextMuted: boolean) => {
        for (const track of rawStream?.getAudioTracks() ?? []) {
          track.enabled = !nextMuted;
        }

        setOutboundTrackEnabled(!nextMuted);
      },
      destroy: () => {
        if (rawStream) {
          stopTracks(rawStream);
        }
      },
    };
  }

  const audioContext = new AudioContextCtor({
    latencyHint: "interactive",
  });
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;

  const destination = audioContext.createMediaStreamDestination();
  analyser.connect(destination);
  outboundStream = destination.stream;

  let source: MediaStreamAudioSourceNode | null =
    audioContext.createMediaStreamSource(rawStream);
  let rnnoiseNode: RnnoiseNode | null = null;
  let isDestroyed = false;
  let requestedMuted = false;
  let appliedMuted = false;
  let muteOperation = Promise.resolve();

  const stopCurrentRawStream = () => {
    disconnectNode(source);
    source = null;

    if (rawStream) {
      stopTracks(rawStream);
      rawStream = null;
    }
  };

  const connectCurrentSource = () => {
    if (!source) {
      return;
    }

    disconnectNode(source);
    if (rnnoiseNode) {
      source.connect(rnnoiseNode);
      return;
    }

    source.connect(analyser);
  };

  const connectStandardGraph = () => {
    disconnectNode(rnnoiseNode);
    connectCurrentSource();
  };

  const handleRuntimeFallback = () => {
    if (isDestroyed) {
      return;
    }

    console.warn("RNNoise processor failed; falling back to standard mic processing.");
    rnnoiseNode?.removeEventListener("processorerror", handleRuntimeFallback);
    disconnectNode(rnnoiseNode);
    rnnoiseNode?.destroy();
    rnnoiseNode = null;
    connectStandardGraph();
    updateState({
      mode: "standard",
      reason: "runtime-fallback",
    });
  };

  const connectEnhancedGraph = (node: RnnoiseNode) => {
    rnnoiseNode?.removeEventListener("processorerror", handleRuntimeFallback);
    disconnectNode(rnnoiseNode);
    rnnoiseNode?.destroy();
    rnnoiseNode = node;
    rnnoiseNode.addEventListener("processorerror", handleRuntimeFallback);
    rnnoiseNode.connect(analyser);
    connectCurrentSource();
  };

  const restoreMicrophoneCapture = async () => {
    if (source) {
      return;
    }

    const nextRawStream = await navigator.mediaDevices.getUserMedia({
      audio: microphoneConstraints,
    });

    if (isDestroyed || requestedMuted) {
      stopTracks(nextRawStream);
      return;
    }

    rawStream = nextRawStream;
    source = audioContext.createMediaStreamSource(nextRawStream);
    connectCurrentSource();
  };

  const syncRequestedMuteState = async () => {
    while (!isDestroyed && appliedMuted !== requestedMuted) {
      const nextMuted = requestedMuted;

      if (nextMuted) {
        setOutboundTrackEnabled(false);
        stopCurrentRawStream();
        appliedMuted = true;
        continue;
      }

      await restoreMicrophoneCapture();
      if (isDestroyed) {
        return;
      }

      if (requestedMuted) {
        setOutboundTrackEnabled(false);
        stopCurrentRawStream();
        appliedMuted = true;
        continue;
      }

      setOutboundTrackEnabled(true);
      appliedMuted = false;
    }
  };

  try {
    if (
      typeof window.AudioWorkletNode === "undefined" ||
      !("audioWorklet" in audioContext)
    ) {
      connectStandardGraph();
      onStateChange?.(currentState);
    } else {
      const { RnnoiseWorkletNode, loadRnnoise } =
        (await import(
          "@sapphi-red/web-noise-suppressor"
        )) as WebNoiseSuppressor;

      const [wasmBinary] = await Promise.all([
        loadRnnoise({
          url: rnnoiseWasmPath,
          simdUrl: rnnoiseSimdWasmPath,
        }),
        audioContext.audioWorklet.addModule(rnnoiseWorkletPath),
      ]);

      const node = new RnnoiseWorkletNode(audioContext, {
        wasmBinary,
        maxChannels: 1,
      }) as RnnoiseNode;

      connectEnhancedGraph(node);
      updateState({
        mode: "enhanced",
        reason: "active",
      });
    }
  } catch (error) {
    console.warn(
      "RNNoise could not start; falling back to standard mic processing.",
      error,
    );
    connectStandardGraph();
    updateState({
      mode: "standard",
      reason: "init-failed",
    });
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }

  return {
    outboundStream,
    analyser,
    setMuted: (nextMuted: boolean) => {
      requestedMuted = nextMuted;
      const operation = muteOperation.then(syncRequestedMuteState);
      muteOperation = operation.catch(() => undefined);
      return operation;
    },
    destroy: () => {
      if (isDestroyed) {
        return;
      }

      isDestroyed = true;
      rnnoiseNode?.removeEventListener("processorerror", handleRuntimeFallback);
      disconnectNode(source);
      disconnectNode(rnnoiseNode);
      disconnectNode(analyser);
      rnnoiseNode?.destroy();
      rnnoiseNode = null;
      source = null;
      stopTracks(outboundStream);
      if (rawStream) {
        stopTracks(rawStream);
        rawStream = null;
      }
      void audioContext.close().catch(() => undefined);
    },
  };
}
