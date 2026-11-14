import {
  boardColors,
  boardWidths,
  boardWidth,
  boardHeight,
  boardLimits,
  type BoardCommand,
  type BoardPoint,
  type BoardSnapshot,
  type BoardStroke,
  type BoardUpdate,
} from "./whiteboard";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is BoardPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 0 &&
    value[0] <= boardWidth &&
    value[1] >= 0 &&
    value[1] <= boardHeight
  );
}

function isCommand(value: unknown): value is BoardCommand {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) < 0
  )
    return false;
  if (value.type === "clear" || value.type === "undo") return true;
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id))
    return false;
  if (value.type === "start") {
    return (
      (value.tool === "pen" || value.tool === "eraser") &&
      boardColors.some((color) => color === value.color) &&
      boardWidths.some((width) => width === value.width) &&
      isPoint(value.point)
    );
  }
  if (value.type === "append") {
    return (
      Number.isSafeInteger(value.offset) &&
      (value.offset as number) >= 1 &&
      typeof value.done === "boolean" &&
      Array.isArray(value.points) &&
      value.points.length <= boardLimits.pointsPerMessage &&
      (value.points.length > 0 || value.done) &&
      value.points.every(isPoint)
    );
  }
  return false;
}

type BoardResult = { update: BoardUpdate } | { error: string } | null;

/** One bounded, temporary board. Only the server chooses ownership and ordering. */
export class RoomWhiteboard {
  private epoch = 0;
  private strokes = new Map<string, BoardStroke>();
  private pointCount = 0;
  private rateLimits = new Map<string, { tokens: number; updatedAt: number }>();

  snapshot(): BoardSnapshot {
    return structuredClone({
      epoch: this.epoch,
      strokes: [...this.strokes.values()],
    });
  }

  reset() {
    this.epoch += 1;
    this.strokes.clear();
    this.pointCount = 0;
    this.rateLimits.clear();
  }

  removeParticipant(userId: string) {
    this.rateLimits.delete(userId);
  }

  private consumeToken(userId: string, now: number) {
    const previous = this.rateLimits.get(userId) ?? {
      tokens: 50,
      updatedAt: now,
    };
    const tokens = Math.min(
      50,
      previous.tokens + Math.max(0, now - previous.updatedAt) * 0.05,
    );
    this.rateLimits.set(userId, {
      tokens: Math.max(0, tokens - 1),
      updatedAt: now,
    });
    return tokens >= 1;
  }

  apply(userId: string, input: unknown, now = Date.now()): BoardResult {
    if (!this.consumeToken(userId, now))
      return { error: "Drawing too quickly. Pause briefly and try again." };
    if (!isCommand(input)) return { error: "Invalid drawing command." };
    // A clear may overtake a batch still buffered on another participant's device.
    if (input.epoch !== this.epoch) return null;

    if (input.type === "clear") {
      this.epoch += 1;
      this.strokes.clear();
      this.pointCount = 0;
      return { update: { type: "cleared", epoch: this.epoch } };
    }
    if (input.type === "undo") {
      const stroke = [...this.strokes.values()]
        .reverse()
        .find((entry) => entry.ownerId === userId);
      if (!stroke) return null;
      this.pointCount -= stroke.points.length;
      this.strokes.delete(stroke.id);
      return { update: { type: "removed", epoch: this.epoch, id: stroke.id } };
    }
    if (input.type === "start") {
      if (this.strokes.has(input.id))
        return { error: "That stroke already exists." };
      if (
        this.strokes.size >= boardLimits.strokes ||
        this.pointCount >= boardLimits.points
      ) {
        return {
          error: "Board is full. Undo a stroke or clear the board to continue.",
        };
      }
      const stroke: BoardStroke = {
        id: input.id,
        ownerId: userId,
        tool: input.tool,
        color: input.color,
        width: input.width,
        points: [input.point],
        done: false,
      };
      this.strokes.set(stroke.id, stroke);
      this.pointCount += 1;
      return {
        update: {
          type: "started",
          epoch: this.epoch,
          stroke: structuredClone(stroke),
        },
      };
    }

    const stroke = this.strokes.get(input.id);
    if (
      !stroke ||
      stroke.ownerId !== userId ||
      stroke.done ||
      input.offset !== stroke.points.length
    ) {
      return { error: "That stroke cannot be changed. Start a new stroke." };
    }
    if (
      stroke.points.length + input.points.length >
        boardLimits.pointsPerStroke ||
      this.pointCount + input.points.length > boardLimits.points
    ) {
      return {
        error:
          "Drawing limit reached. Undo a stroke or clear the board to continue.",
      };
    }
    stroke.points.push(...input.points);
    stroke.done = input.done;
    this.pointCount += input.points.length;
    return {
      update: {
        type: "appended",
        epoch: this.epoch,
        id: stroke.id,
        offset: input.offset,
        points: input.points,
        done: input.done,
      },
    };
  }
}
