import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type ShortcutKeysProps = ComponentProps<"span"> & {
  keys: readonly string[];
  keyClassName?: string;
};

export function ShortcutKeys({
  className,
  keyClassName,
  keys,
  ...props
}: ShortcutKeysProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} {...props}>
      {keys.map((key) => (
        <kbd
          key={key}
          className={cn(
            "inline-flex min-w-6 items-center justify-center rounded border border-primary/30 bg-background/95 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary shadow-[0_0_10px_rgba(0,255,65,0.15)]",
            keyClassName,
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
