import { describe, expect, test } from "bun:test";
import { RoomWhiteboard } from "../src/lib/room-whiteboard";
import {
  applyBoardUpdate,
  boardLimits,
  type BoardCommand,
  type BoardPoint,
  type BoardSnapshot,
  type BoardUpdate,
} from "../src/lib/whiteboard";

function start(id: string, epoch = 0): BoardCommand {
  return {
    type: "start",
    epoch,
    id,
    tool: "pen",
    color: "#00ff41",
    width: 5,
    point: [100, 100],
  };
}

describe("temporary room whiteboard", () => {
  test("assigns ownership and rejects changing another participant's stroke or replaying a batch", () => {
    const board = new RoomWhiteboard();
    board.apply("alice", { ...start("stroke-a"), ownerId: "bob" });
    expect(board.snapshot().strokes[0]?.ownerId).toBe("alice");
    const append = {
      type: "append",
      epoch: 0,
      id: "stroke-a",
      offset: 1,
      points: [[200, 100]],
      done: true,
    };
    expect(board.apply("bob", append)).toHaveProperty("error");
    expect(board.snapshot().strokes[0]?.points).toHaveLength(1);
    expect(board.apply("alice", append)).toHaveProperty("update");
    expect(board.apply("alice", append)).toHaveProperty("error");
    expect(board.snapshot().strokes[0]?.points).toHaveLength(2);
    const snapshot = board.snapshot();
    snapshot.strokes.length = 0;
    expect(board.snapshot().strokes).toHaveLength(1);
  });

  test("undo removes only the caller's latest stroke", () => {
    const board = new RoomWhiteboard();
    board.apply("alice", start("a1"));
    expect(board.apply("bob", { type: "undo", epoch: 0 })).toBeNull();
    board.apply("bob", start("b1"));
    board.apply("alice", start("a2"));
    board.apply("alice", { type: "undo", epoch: 0 });
    expect(board.snapshot().strokes.map((stroke) => stroke.id)).toEqual([
      "a1",
      "b1",
    ]);
  });

  test("clear and empty-room reset invalidate buffered messages", () => {
    const board = new RoomWhiteboard();
    board.apply("alice", start("a1"));
    expect(board.apply("bob", { type: "clear", epoch: 0 })).toEqual({
      update: { type: "cleared", epoch: 1 },
    });
    expect(
      board.apply("alice", {
        type: "append",
        epoch: 0,
        id: "a1",
        offset: 1,
        points: [[200, 100]],
        done: true,
      }),
    ).toBeNull();
    expect(board.apply("alice", start("old", 0))).toBeNull();
    board.apply("alice", start("current", 1));
    board.reset();
    expect(board.snapshot()).toEqual({ epoch: 2, strokes: [] });
  });

  test("validates coordinates, colors, widths, IDs and bounded batches", () => {
    const board = new RoomWhiteboard();
    const malformed = [
      null,
      [],
      12,
      { ...start("a"), epoch: -1 },
      { ...start("a"), id: "x".repeat(65) },
      { ...start("a"), point: [NaN, 1] },
      { ...start("a"), point: [1025, 0] },
      { ...start("a"), point: [0, -1] },
      { ...start("a"), color: "url(bad)" },
      { ...start("a"), width: 999 },
    ];
    for (const command of malformed)
      expect(board.apply("alice", command)).toHaveProperty("error");
    board.apply("alice", start("a"));
    expect(
      board.apply("alice", {
        type: "append",
        epoch: 0,
        id: "a",
        offset: 1,
        points: Array(33).fill([1, 1]),
        done: false,
      }),
    ).toHaveProperty("error");
    expect(board.snapshot().strokes[0]?.points).toHaveLength(1);
  });

  test("bounds retained strokes and reclaims space on undo", () => {
    const board = new RoomWhiteboard();
    for (let i = 0; i < boardLimits.strokes; i++)
      expect(board.apply("alice", start(`s-${i}`), i * 25)).toHaveProperty(
        "update",
      );
    expect(board.apply("alice", start("full"), 20_000)).toHaveProperty("error");
    board.apply("alice", { type: "undo", epoch: 0 }, 20_025);
    expect(board.apply("alice", start("reclaimed"), 20_050)).toHaveProperty(
      "update",
    );
  });

  test("bounds total points and each stroke without evicting people's drawings", () => {
    const board = new RoomWhiteboard();
    let time = 0;
    for (let i = 0; i < boardLimits.points / boardLimits.pointsPerStroke; i++) {
      expect(
        board.apply("alice", start(`s-${i}`), (time += 25)),
      ).toHaveProperty("update");
      for (
        let offset = 1;
        offset < boardLimits.pointsPerStroke;
        offset += boardLimits.pointsPerMessage
      ) {
        const size = Math.min(
          boardLimits.pointsPerMessage,
          boardLimits.pointsPerStroke - offset,
        );
        const points: BoardPoint[] = Array.from({ length: size }, () => [
          200, 100,
        ]);
        expect(
          board.apply(
            "alice",
            {
              type: "append",
              epoch: 0,
              id: `s-${i}`,
              offset,
              points,
              done: offset + size === boardLimits.pointsPerStroke,
            },
            (time += 25),
          ),
        ).toHaveProperty("update");
      }
    }
    expect(
      board
        .snapshot()
        .strokes.reduce((sum, stroke) => sum + stroke.points.length, 0),
    ).toBe(boardLimits.points);
    expect(board.apply("alice", start("full"), (time += 25))).toHaveProperty(
      "error",
    );
    board.apply("alice", { type: "undo", epoch: 0 }, (time += 25));
    expect(board.apply("alice", start("space"), (time += 25))).toHaveProperty(
      "update",
    );
  });

  test("rate limits one participant without blocking another or a later recovery", () => {
    const board = new RoomWhiteboard();
    for (let i = 0; i < 50; i++)
      board.apply("alice", { type: "undo", epoch: 0 }, 0);
    expect(board.apply("alice", start("limited"), 0)).toHaveProperty("error");
    expect(board.apply("bob", start("other"), 0)).toHaveProperty("update");
    expect(board.apply("alice", start("recovered"), 1000)).toHaveProperty(
      "update",
    );
  });
});

test("client convergence ignores duplicate and stale batches after clear", () => {
  const board = new RoomWhiteboard();
  let client: BoardSnapshot = { epoch: 0, strokes: [] };
  const events: BoardUpdate[] = [];
  const commands: BoardCommand[] = [
    start("a"),
    {
      type: "append",
      epoch: 0,
      id: "a",
      offset: 1,
      points: [[200, 100]],
      done: true,
    },
  ];
  for (const command of commands) {
    const result = board.apply("alice", command);
    if (result && "update" in result) {
      events.push(result.update);
      client = applyBoardUpdate(client, result.update);
    }
  }
  expect(client).toEqual(board.snapshot());
  client = applyBoardUpdate(client, events[0]!);
  client = applyBoardUpdate(client, events[1]!);
  expect(client).toEqual(board.snapshot());
  client = applyBoardUpdate(client, { type: "cleared", epoch: 1 });
  client = applyBoardUpdate(client, events[0]!);
  expect(client).toEqual({ epoch: 1, strokes: [] });
});
