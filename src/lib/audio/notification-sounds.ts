export type NotificationCue =
  | "join"
  | "leave"
  | "afk"
  | "mute"
  | "unmute"
  | "screen-share-start"
  | "screen-share-stop";

type CueStep = {
  durationMs: number;
  frequency: number;
  gain: number;
  slideToFrequency?: number;
  type?: OscillatorType;
};

const cueStepsById: Record<NotificationCue, readonly CueStep[]> = {
  join: [
    { frequency: 660, durationMs: 70, gain: 0.18, type: "triangle" },
    {
      frequency: 880,
      durationMs: 85,
      gain: 0.2,
      slideToFrequency: 990,
      type: "triangle",
    },
  ],
  leave: [
    {
      frequency: 587,
      durationMs: 85,
      gain: 0.16,
      slideToFrequency: 494,
      type: "sine",
    },
    { frequency: 392, durationMs: 75, gain: 0.14, type: "sine" },
  ],
  afk: [
    { frequency: 698, durationMs: 55, gain: 0.12, type: "triangle" },
    {
      frequency: 554,
      durationMs: 70,
      gain: 0.14,
      slideToFrequency: 440,
      type: "triangle",
    },
    { frequency: 349, durationMs: 85, gain: 0.12, type: "sine" },
  ],
  mute: [
    {
      frequency: 460,
      durationMs: 120,
      gain: 0.16,
      slideToFrequency: 340,
      type: "square",
    },
  ],
  unmute: [
    {
      frequency: 340,
      durationMs: 120,
      gain: 0.14,
      slideToFrequency: 520,
      type: "triangle",
    },
  ],
  "screen-share-start": [
    { frequency: 520, durationMs: 55, gain: 0.12, type: "square" },
    { frequency: 780, durationMs: 65, gain: 0.14, type: "square" },
    {
      frequency: 1040,
      durationMs: 70,
      gain: 0.16,
      slideToFrequency: 1170,
      type: "triangle",
    },
  ],
  "screen-share-stop": [
    { frequency: 980, durationMs: 50, gain: 0.12, type: "triangle" },
    {
      frequency: 740,
      durationMs: 70,
      gain: 0.14,
      slideToFrequency: 620,
      type: "triangle",
    },
    { frequency: 466, durationMs: 70, gain: 0.12, type: "sine" },
  ],
};

let notificationAudioContext: AudioContext | null = null;
let notificationMasterGainNode: GainNode | null = null;

function ensureNotificationAudio() {
  if (typeof window === "undefined") {
    return null;
  }

  if (notificationAudioContext?.state === "closed") {
    notificationAudioContext = null;
    notificationMasterGainNode = null;
  }

  if (notificationAudioContext && notificationMasterGainNode) {
    return {
      audioContext: notificationAudioContext,
      masterGainNode: notificationMasterGainNode,
    };
  }

  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  try {
    const audioContext = new AudioContextCtor({
      latencyHint: "interactive",
    });
    const masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = 0.24;
    masterGainNode.connect(audioContext.destination);

    notificationAudioContext = audioContext;
    notificationMasterGainNode = masterGainNode;
    return {
      audioContext,
      masterGainNode,
    };
  } catch {
    return null;
  }
}

function dispatchNotificationSoundEvent(cue: NotificationCue) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("nexus:notification-sound", {
      detail: { cue },
    }),
  );
}

function scheduleCuePlayback(
  audioContext: AudioContext,
  masterGainNode: GainNode,
  cue: NotificationCue,
) {
  const steps = cueStepsById[cue];
  let nextStartTime = audioContext.currentTime + 0.005;

  for (const step of steps) {
    const oscillator = audioContext.createOscillator();
    const envelopeGain = audioContext.createGain();
    const durationSeconds = step.durationMs / 1000;
    const endTime = nextStartTime + durationSeconds;
    const oscillatorType = step.type ?? "sine";

    oscillator.type = oscillatorType;
    oscillator.frequency.setValueAtTime(step.frequency, nextStartTime);

    if (step.slideToFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        step.slideToFrequency,
        endTime,
      );
    }

    envelopeGain.gain.setValueAtTime(0.0001, nextStartTime);
    envelopeGain.gain.exponentialRampToValueAtTime(
      Math.max(step.gain, 0.0002),
      nextStartTime + 0.01,
    );
    envelopeGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscillator.connect(envelopeGain);
    envelopeGain.connect(masterGainNode);
    oscillator.start(nextStartTime);
    oscillator.stop(endTime + 0.02);

    nextStartTime = endTime + 0.012;
  }
}

export function resumeNotificationAudio() {
  const audio = ensureNotificationAudio();
  if (!audio || audio.audioContext.state !== "suspended") {
    return;
  }

  void audio.audioContext.resume().catch(() => undefined);
}

export function playNotificationCue(cue: NotificationCue) {
  dispatchNotificationSoundEvent(cue);

  const audio = ensureNotificationAudio();
  if (!audio) {
    return;
  }

  const play = () => {
    try {
      scheduleCuePlayback(audio.audioContext, audio.masterGainNode, cue);
    } catch {
      return;
    }
  };

  if (audio.audioContext.state === "suspended") {
    void audio.audioContext
      .resume()
      .then(() => {
        if (audio.audioContext.state === "running") {
          play();
        }
      })
      .catch(() => undefined);
    return;
  }

  if (audio.audioContext.state !== "running") {
    return;
  }

  play();
}
