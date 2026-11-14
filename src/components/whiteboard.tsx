import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  EraserIcon,
  PenLineIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useWhiteboard } from "@/hooks/use-whiteboard";
import { cn } from "@/lib/utils";
import {
  boardColors,
  boardWidths,
  boardWidth,
  boardHeight,
  boardLimits,
  type BoardColor,
  type BoardPoint,
  type BoardStroke,
  type BoardTool,
} from "@/lib/whiteboard";

interface WhiteboardProps {
  board: ReturnType<typeof useWhiteboard>;
  selfUserId: string;
  disabled: boolean;
  onClose: () => void;
}

interface Draft {
  stroke: BoardStroke;
  epoch: number;
  sentPoints: number;
}

const colorNames = ["Green", "Cyan", "Amber", "Rose"];

function drawStroke(context: CanvasRenderingContext2D, stroke: BoardStroke) {
  const first = stroke.points[0];
  if (!first) return;
  context.globalCompositeOperation =
    stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth =
    stroke.tool === "eraser" ? stroke.width * 4 : stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first[0], first[1], context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first[0], first[1]);
  for (const point of stroke.points.slice(1))
    context.lineTo(point[0], point[1]);
  context.stroke();
}

export function Whiteboard({
  board,
  selfUserId,
  disabled,
  onClose,
}: WhiteboardProps) {
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRef = useRef({ board, disabled });
  latestRef.current = { board, disabled };
  const draftsRef = useRef(new Map<string, Draft>());
  const activeRef = useRef<{ id: string; pointerId: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [tool, setTool] = useState<BoardTool>("pen");
  const [color, setColor] = useState<BoardColor>(boardColors[0]);
  const [width, setWidth] = useState<number>(5);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Repaint only after input, room updates, or resizing; an idle board does no work. */
  function schedulePaint() {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(canvas.clientWidth * scale));
      const pixelHeight = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(
        pixelWidth / boardWidth,
        0,
        0,
        pixelHeight / boardHeight,
        0,
        0,
      );
      context.clearRect(0, 0, boardWidth, boardHeight);
      const confirmed = latestRef.current.board.snapshot.strokes;
      const confirmedIds = new Set(confirmed.map((stroke) => stroke.id));
      for (const stroke of confirmed)
        drawStroke(context, draftsRef.current.get(stroke.id)?.stroke ?? stroke);
      for (const [id, draft] of draftsRef.current) {
        if (!confirmedIds.has(id)) drawStroke(context, draft.stroke);
      }
      context.globalCompositeOperation = "source-over";
    });
  }

  function clearTimer() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function cancelDrafts() {
    clearTimer();
    activeRef.current = null;
    draftsRef.current.clear();
    schedulePaint();
  }

  function flush(draft: Draft, done: boolean) {
    do {
      const points = draft.stroke.points.slice(
        draft.sentPoints,
        draft.sentPoints + boardLimits.pointsPerMessage,
      );
      const isLast =
        draft.sentPoints + points.length === draft.stroke.points.length;
      if (!points.length && !done) return;
      const sent = latestRef.current.board.send({
        type: "append",
        epoch: draft.epoch,
        id: draft.stroke.id,
        offset: draft.sentPoints,
        points,
        done: done && isLast,
      });
      if (!sent) {
        cancelDrafts();
        return;
      }
      draft.sentPoints += points.length;
      if (isLast) break;
    } while (draft.sentPoints < draft.stroke.points.length);
    if (done) draft.stroke.done = true;
  }

  function finishStroke() {
    clearTimer();
    const active = activeRef.current;
    activeRef.current = null;
    const draft = active && draftsRef.current.get(active.id);
    if (draft) flush(draft, true);
    schedulePaint();
  }

  function getPoint(event: PointerEvent<HTMLCanvasElement>): BoardPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.round(
        Math.max(
          0,
          Math.min(
            boardWidth,
            ((event.clientX - rect.left) / rect.width) * boardWidth,
          ),
        ),
      ),
      Math.round(
        Math.max(
          0,
          Math.min(
            boardHeight,
            ((event.clientY - rect.top) / rect.height) * boardHeight,
          ),
        ),
      ),
    ];
  }

  function startStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || !board.isReady || event.button !== 0 || activeRef.current)
      return;
    event.preventDefault();
    setNotice(null);
    if (draftsRef.current.size >= 32) {
      setNotice("Waiting for the whiteboard connection to catch up.");
      return;
    }
    const stroke: BoardStroke = {
      id: crypto.randomUUID(),
      ownerId: selfUserId,
      tool,
      color,
      width,
      points: [getPoint(event)],
      done: false,
    };
    if (
      !board.send({
        type: "start",
        epoch: board.snapshot.epoch,
        id: stroke.id,
        tool,
        color,
        width,
        point: stroke.points[0]!,
      })
    )
      return;
    draftsRef.current.set(stroke.id, {
      stroke,
      epoch: board.snapshot.epoch,
      sentPoints: 1,
    });
    activeRef.current = { id: stroke.id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    schedulePaint();
  }

  function extendStroke(event: PointerEvent<HTMLCanvasElement>) {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const draft = draftsRef.current.get(active.id);
    if (!draft) return;
    const point = getPoint(event);
    const previous = draft.stroke.points.at(-1);
    if (previous?.[0] === point[0] && previous[1] === point[1]) return;
    if (draft.stroke.points.length >= boardLimits.pointsPerStroke) {
      finishStroke();
      setNotice("Lift your pointer to start another stroke.");
      return;
    }
    draft.stroke.points.push(point);
    schedulePaint();
    if (timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (activeRef.current?.id === draft.stroke.id) flush(draft, false);
      }, boardLimits.batchIntervalMs);
    }
  }

  useEffect(() => {
    for (const stroke of board.snapshot.strokes) {
      if (stroke.done) draftsRef.current.delete(stroke.id);
    }
    schedulePaint();
  }, [board.snapshot]);

  useEffect(() => {
    cancelDrafts();
    setConfirmClear(false);
  }, [board.snapshot.epoch, board.isReady, disabled]);

  useEffect(() => {
    if (board.error) cancelDrafts();
  }, [board.error]);

  useEffect(() => {
    stageRef.current?.scrollIntoView({ block: "start" });
    const observer = new ResizeObserver(schedulePaint);
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener("blur", finishStroke);
    return () => {
      finishStroke();
      observer.disconnect();
      window.removeEventListener("blur", finishStroke);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const controlsDisabled = disabled || !board.isReady;
  const controlClass = "border-primary/30 font-mono text-xs text-primary";

  return (
    <section
      ref={stageRef}
      data-testid="whiteboard-stage"
      className="mb-8 w-full max-w-6xl scroll-mt-20 rounded-xl border border-primary/30 bg-background/95 p-3 sm:p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
            Shared whiteboard
          </h2>
          <p className="mt-1 text-xs font-mono text-muted-foreground">
            Everyone can draw. Clears when the room is empty.
          </p>
        </div>
        <Button
          aria-label="Hide whiteboard"
          onClick={onClose}
          size="icon"
          variant="outline"
          className={controlClass}
        >
          <XIcon />
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          aria-label="Use pen"
          aria-pressed={tool === "pen"}
          disabled={controlsDisabled}
          onClick={() => setTool("pen")}
          variant="outline"
          size="sm"
          className={cn(controlClass, tool === "pen" && "bg-primary/20")}
        >
          <PenLineIcon /> Pen
        </Button>
        <Button
          aria-label="Use eraser"
          aria-pressed={tool === "eraser"}
          disabled={controlsDisabled}
          onClick={() => setTool("eraser")}
          variant="outline"
          size="sm"
          className={cn(controlClass, tool === "eraser" && "bg-primary/20")}
        >
          <EraserIcon /> Eraser
        </Button>
        <div className="flex gap-1" role="group" aria-label="Pen color">
          {boardColors.map((value, index) => (
            <button
              key={value}
              type="button"
              aria-label={`${colorNames[index]} pen`}
              aria-pressed={color === value}
              disabled={controlsDisabled}
              onClick={() => {
                setColor(value);
                setTool("pen");
              }}
              className={cn(
                "h-7 w-7 rounded-full border-2 disabled:opacity-40",
                color === value
                  ? "border-primary ring-1 ring-primary/60"
                  : "border-transparent",
              )}
            >
              <span
                className="mx-auto block h-4 w-4 rounded-full"
                style={{ backgroundColor: value }}
              />
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 px-1 text-xs font-mono text-primary">
          Width
          <select
            aria-label="Stroke width"
            value={width}
            disabled={controlsDisabled}
            onChange={(event) => setWidth(Number(event.target.value))}
            className="rounded border border-primary/30 bg-background px-2 py-1"
          >
            {boardWidths.map((value) => (
              <option key={value} value={value}>
                {value === 2 ? "Fine" : value === 5 ? "Medium" : "Bold"}
              </option>
            ))}
          </select>
        </label>
        <Button
          aria-label="Undo my last stroke"
          disabled={
            controlsDisabled ||
            !board.snapshot.strokes.some(
              (stroke) => stroke.ownerId === selfUserId,
            )
          }
          onClick={() => {
            finishStroke();
            board.send({ type: "undo", epoch: board.snapshot.epoch });
          }}
          variant="outline"
          size="sm"
          className={controlClass}
        >
          <Undo2Icon /> Undo mine
        </Button>
        <Button
          aria-label="Clear board"
          disabled={controlsDisabled || !board.snapshot.strokes.length}
          onClick={() => setConfirmClear(true)}
          variant="outline"
          size="sm"
          className={controlClass}
        >
          <Trash2Icon /> Clear
        </Button>
      </div>
      {confirmClear && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs font-mono text-primary">
          <span>Clear everyone’s drawing?</span>
          <Button
            size="sm"
            variant="outline"
            className={controlClass}
            onClick={() => setConfirmClear(false)}
          >
            Cancel
          </Button>
          <Button
            aria-label="Confirm clear whiteboard"
            size="sm"
            variant="destructive"
            disabled={controlsDisabled}
            onClick={() => {
              finishStroke();
              board.send({ type: "clear", epoch: board.snapshot.epoch });
              setConfirmClear(false);
            }}
          >
            Clear drawing
          </Button>
        </div>
      )}
      <canvas
        ref={canvasRef}
        aria-label="Collaborative whiteboard"
        className={cn(
          "block aspect-video w-full touch-none rounded-lg border border-primary/20 bg-background",
          controlsDisabled
            ? "cursor-not-allowed"
            : tool === "eraser"
              ? "cursor-cell"
              : "cursor-crosshair",
        )}
        onPointerDown={startStroke}
        onPointerMove={extendStroke}
        onPointerUp={(event) => {
          if (activeRef.current?.pointerId === event.pointerId) {
            extendStroke(event);
            finishStroke();
          }
        }}
        onPointerCancel={(event) => {
          if (activeRef.current?.pointerId === event.pointerId) finishStroke();
        }}
        onLostPointerCapture={(event) => {
          if (activeRef.current?.pointerId === event.pointerId) finishStroke();
        }}
      >
        Shared drawing canvas.
      </canvas>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs font-mono text-muted-foreground">
        <p>
          {!board.isReady
            ? "Whiteboard reconnecting…"
            : disabled
              ? "Return to the connected room to draw."
              : "Draw with a mouse, pen, or touch."}
        </p>
        <p>
          {board.snapshot.strokes.length}{" "}
          {board.snapshot.strokes.length === 1 ? "stroke" : "strokes"}
        </p>
      </div>
      {(board.error || notice) && (
        <p role="status" className="mt-2 text-xs font-mono text-amber-300">
          {board.error ?? notice}
        </p>
      )}
    </section>
  );
}
