export const boardWidth = 1024;
export const boardHeight = 576;
export const boardColors = [
  "#00ff41",
  "#22d3ee",
  "#fbbf24",
  "#fb7185",
] as const;
export const boardWidths = [2, 5, 10] as const;
export const boardLimits = {
  strokes: 512,
  points: 16_384,
  pointsPerStroke: 2048,
  pointsPerMessage: 32,
  batchIntervalMs: 50,
} as const;

export type BoardPoint = [number, number];
export type BoardColor = (typeof boardColors)[number];
export type BoardTool = "pen" | "eraser";

export interface BoardStroke {
  id: string;
  ownerId: string;
  tool: BoardTool;
  color: BoardColor;
  width: number;
  points: BoardPoint[];
  done: boolean;
}

export interface BoardSnapshot {
  epoch: number;
  strokes: BoardStroke[];
}

export type BoardCommand =
  | {
      type: "start";
      epoch: number;
      id: string;
      tool: BoardTool;
      color: BoardColor;
      width: number;
      point: BoardPoint;
    }
  | {
      type: "append";
      epoch: number;
      id: string;
      offset: number;
      points: BoardPoint[];
      done: boolean;
    }
  | { type: "undo"; epoch: number }
  | { type: "clear"; epoch: number };

export type BoardUpdate =
  | { type: "started"; epoch: number; stroke: BoardStroke }
  | {
      type: "appended";
      epoch: number;
      id: string;
      offset: number;
      points: BoardPoint[];
      done: boolean;
    }
  | { type: "removed"; epoch: number; id: string }
  | { type: "cleared"; epoch: number };

/** Apply ordered server updates; stale batches cannot restore a cleared board. */
export function applyBoardUpdate(
  snapshot: BoardSnapshot,
  update: BoardUpdate,
): BoardSnapshot {
  if (update.type === "cleared") {
    return update.epoch > snapshot.epoch
      ? { epoch: update.epoch, strokes: [] }
      : snapshot;
  }
  if (update.epoch !== snapshot.epoch) return snapshot;
  if (update.type === "started") {
    if (snapshot.strokes.some((stroke) => stroke.id === update.stroke.id))
      return snapshot;
    return { ...snapshot, strokes: [...snapshot.strokes, update.stroke] };
  }
  if (update.type === "removed") {
    return {
      ...snapshot,
      strokes: snapshot.strokes.filter((stroke) => stroke.id !== update.id),
    };
  }
  return {
    ...snapshot,
    strokes: snapshot.strokes.map((stroke) =>
      stroke.id === update.id && stroke.points.length === update.offset
        ? {
            ...stroke,
            points: [...stroke.points, ...update.points],
            done: update.done,
          }
        : stroke,
    ),
  };
}
