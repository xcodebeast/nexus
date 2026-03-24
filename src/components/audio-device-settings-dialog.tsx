import type { ChangeEventHandler } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AudioDeviceOption } from "@/hooks/use-voice-room";

interface AudioDeviceSettingsDialogProps {
  audioDevices: {
    microphones: AudioDeviceOption[];
    speakers: AudioDeviceOption[];
  };
  audioDeviceStatus: {
    isLoading: boolean;
    microphoneError: string | null;
    speakerError: string | null;
    speakerSelectionSupported: boolean;
  };
  isOpen: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onSelectMicrophone: (deviceId: string) => Promise<void> | void;
  onSelectSpeaker: (deviceId: string) => Promise<void> | void;
  selectedMicrophoneId: string;
  selectedSpeakerId: string;
}

const selectClassName =
  "h-11 w-full rounded-md border border-primary/35 bg-black/65 px-3 text-sm font-mono text-primary shadow-[0_0_18px_rgba(0,255,65,0.08)] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-60";

export function AudioDeviceSettingsDialog({
  audioDevices,
  audioDeviceStatus,
  isOpen,
  onOpenChange,
  onSelectMicrophone,
  onSelectSpeaker,
  selectedMicrophoneId,
  selectedSpeakerId,
}: AudioDeviceSettingsDialogProps) {
  const hasDetectedMicrophones = audioDevices.microphones.some(
    (device) => !device.isDefault,
  );
  const hasDetectedSpeakers = audioDevices.speakers.some(
    (device) => !device.isDefault,
  );
  const microphoneHelpText =
    audioDeviceStatus.microphoneError ??
    (!hasDetectedMicrophones ? "No microphone detected." : null);
  const speakerHelpText = !audioDeviceStatus.speakerSelectionSupported
    ? "Speaker selection is available in supported Chromium-based browsers."
    : audioDeviceStatus.speakerError ??
      (!hasDetectedSpeakers ? "No speakers detected." : null);
  const microphoneDisabled =
    audioDeviceStatus.isLoading || !hasDetectedMicrophones;
  const speakerDisabled =
    audioDeviceStatus.isLoading ||
    !audioDeviceStatus.speakerSelectionSupported ||
    !hasDetectedSpeakers;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl border-primary/30 bg-black/92 text-primary shadow-[0_0_55px_rgba(0,255,65,0.16)]"
      >
        <DialogHeader className="space-y-3 text-left">
          <DialogTitle className="font-mono text-xl uppercase tracking-[0.22em] text-primary">
            Audio Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <AudioDeviceField
            description={microphoneHelpText}
            disabled={microphoneDisabled}
            isLoading={audioDeviceStatus.isLoading}
            label="Microphone"
            onChange={(event) => void onSelectMicrophone(event.target.value)}
            options={audioDevices.microphones}
            selectId="audio-settings-microphone-select"
            testId="audio-settings-microphone-select"
            value={selectedMicrophoneId}
          />

          <AudioDeviceField
            description={speakerHelpText}
            disabled={speakerDisabled}
            isLoading={audioDeviceStatus.isLoading}
            label="Speakers"
            onChange={(event) => void onSelectSpeaker(event.target.value)}
            options={audioDevices.speakers}
            selectId="audio-settings-speaker-select"
            testId="audio-settings-speaker-select"
            value={selectedSpeakerId}
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            className="border-primary/40 font-mono uppercase tracking-[0.18em] text-primary hover:bg-primary/10"
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AudioDeviceFieldProps {
  description: string | null;
  disabled: boolean;
  isLoading: boolean;
  label: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  options: AudioDeviceOption[];
  selectId: string;
  testId: string;
  value: string;
}

function AudioDeviceField({
  description,
  disabled,
  isLoading,
  label,
  onChange,
  options,
  selectId,
  testId,
  value,
}: AudioDeviceFieldProps) {
  return (
    <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <Label
          className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary/80"
          htmlFor={selectId}
        >
          {label}
        </Label>
        {isLoading && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/55">
            Scanning...
          </span>
        )}
      </div>

      <select
        className={cn(selectClassName)}
        data-testid={testId}
        disabled={disabled}
        id={selectId}
        onChange={onChange}
        value={value}
      >
        {options.map((option) => (
          <option
            className="bg-black text-primary"
            key={`${selectId}-${option.id || "default"}`}
            value={option.id}
          >
            {option.label}
          </option>
        ))}
      </select>

      {description && (
        <p className="font-mono text-[11px] leading-relaxed text-primary/65">
          {description}
        </p>
      )}
    </div>
  );
}
