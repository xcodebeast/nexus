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
  rawStream: MediaStream;
  outboundStream: MediaStream;
  analyser: AnalyserNode | null;
  setMuted: (nextMuted: boolean) => void;
  destroy: () => void;
}

interface PrepareLocalAudioOptions {
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

function buildMicrophoneConstraints(): MediaTrackConstraints {
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

  return constraints;
}

export async function prepareLocalAudio({
  onStateChange,
}: PrepareLocalAudioOptions = {}): Promise<PreparedLocalAudio> {
  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: buildMicrophoneConstraints(),
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

  const setMuted = (nextMuted: boolean) => {
    for (const track of rawStream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }

    for (const track of outboundStream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }
  };

  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) {
    onStateChange?.(currentState);

    return {
      rawStream,
      outboundStream,
      analyser: null,
      setMuted,
      destroy: () => {
        stopTracks(rawStream);
      },
    };
  }

  const audioContext = new AudioContextCtor({
    latencyHint: "interactive",
  });
  const source = audioContext.createMediaStreamSource(rawStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;

  const destination = audioContext.createMediaStreamDestination();
  analyser.connect(destination);
  outboundStream = destination.stream;

  let rnnoiseNode: RnnoiseNode | null = null;
  let isDestroyed = false;

  const connectStandardGraph = () => {
    disconnectNode(source);
    disconnectNode(rnnoiseNode);
    source.connect(analyser);
  };

  const handleRuntimeFallback = () => {
    if (isDestroyed) {
      return;
    }

    console.warn("RNNoise processor failed; falling back to standard mic processing.");
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
    disconnectNode(source);
    disconnectNode(rnnoiseNode);
    rnnoiseNode = node;
    rnnoiseNode.addEventListener("processorerror", handleRuntimeFallback);
    source.connect(rnnoiseNode);
    rnnoiseNode.connect(analyser);
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
    rawStream,
    outboundStream,
    analyser,
    setMuted,
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
      stopTracks(outboundStream);
      stopTracks(rawStream);
      void audioContext.close().catch(() => undefined);
    },
  };
}
