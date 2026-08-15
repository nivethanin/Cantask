import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { db } from "./db.js";

type TaskState = "planned" | "working_on" | "done";

const app = express();
const port = Number(process.env.PORT || 4001);

app.use(cors());
app.use(express.json());

const boardCodeChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(80).optional().default("Untitled Board")
});

const taskStateSchema = z.enum(["planned", "working_on", "done"]);

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional().default(""),
  state: taskStateSchema.optional().default("planned"),
  assigneeIds: z.array(z.string().uuid()).optional().default([])
});

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(4000).optional(),
    state: taskStateSchema.optional(),
    assigneeIds: z.array(z.string().uuid()).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

const createParticipantSchema = z.object({
  name: z.string().trim().min(1).max(40)
});

function normalizeParticipantName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function createBoardCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += boardCodeChars[crypto.randomInt(0, boardCodeChars.length)];
  }
  return code;
}

function getBoardByCode(code: string): { id: string; code: string; name: string } | undefined {
  return db
    .prepare("SELECT id, code, name FROM boards WHERE code = ?")
    .get(code.toUpperCase()) as { id: string; code: string; name: string } | undefined;
}

function getTaskAssigneeMap(taskIds: string[]) {
  if (taskIds.length === 0) {
    return new Map<string, Array<{ id: string; name: string }>>();
  }

  const placeholders = taskIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT tp.task_id as taskId, p.id as participantId, p.name as participantName
      FROM task_participants tp
      JOIN participants p ON p.id = tp.participant_id
      WHERE tp.task_id IN (${placeholders})
      ORDER BY p.name ASC
      `
    )
    .all(...taskIds) as Array<{ taskId: string; participantId: string; participantName: string }>;

  const map = new Map<string, Array<{ id: string; name: string }>>();

  for (const row of rows) {
    const existing = map.get(row.taskId) ?? [];
    existing.push({ id: row.participantId, name: row.participantName });
    map.set(row.taskId, existing);
  }

  return map;
}

function getBoardPayload(boardCode: string) {
  const board = getBoardByCode(boardCode);
  if (!board) {
    return null;
  }

  const participants = db
    .prepare(
      `SELECT id, name
       FROM participants
       WHERE board_id = ?
       ORDER BY name ASC`
    )
    .all(board.id) as Array<{ id: string; name: string }>;

  const tasks = db
    .prepare(
      `SELECT id, title, description, state, position, updated_at
       FROM tasks
       WHERE board_id = ?
       ORDER BY CASE state WHEN 'planned' THEN 1 WHEN 'working_on' THEN 2 ELSE 3 END, position ASC`
    )
    .all(board.id) as Array<{
      id: string;
      title: string;
      description: string;
      state: TaskState;
      position: number;
      updated_at: string;
    }>;

  const assigneeMap = getTaskAssigneeMap(tasks.map((task) => task.id));

  return {
    code: board.code,
    name: board.name,
    participants,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      state: task.state,
      position: task.position,
      updatedAt: task.updated_at,
      assignees: assigneeMap.get(task.id) ?? []
    }))
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/boards", (req, res) => {
  const parsed = createBoardSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const now = new Date().toISOString();
  const boardId = crypto.randomUUID();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createBoardCode();

    try {
      db.prepare("INSERT INTO boards (id, code, name, created_at) VALUES (?, ?, ?, ?)").run(
        boardId,
        code,
        parsed.data.name,
        now
      );

      return res.status(201).json({
        id: boardId,
        code,
        name: parsed.data.name
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("UNIQUE constraint failed: boards.code")) {
        return res.status(500).json({ error: "Failed to create board" });
      }
    }
  }

  return res.status(500).json({ error: "Unable to generate unique board code" });
});

app.get("/api/boards/:code", (req, res) => {
  const boardPayload = getBoardPayload(req.params.code);
  if (!boardPayload) {
    return res.status(404).json({ error: "Board not found" });
  }

  return res.json(boardPayload);
});

app.post("/api/boards/:code/participants", (req, res) => {
  const board = getBoardByCode(req.params.code);
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }

  const parsed = createParticipantSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const normalized = normalizeParticipantName(parsed.data.name);

  const existing = db
    .prepare(
      `SELECT id, name
       FROM participants
       WHERE board_id = ? AND name_normalized = ?`
    )
    .get(board.id, normalized) as { id: string; name: string } | undefined;

  if (existing) {
    return res.status(200).json(existing);
  }

  const participant = {
    id: crypto.randomUUID(),
    name: parsed.data.name,
    boardId: board.id,
    nameNormalized: normalized,
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO participants (id, board_id, name, name_normalized, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(participant.id, participant.boardId, participant.name, participant.nameNormalized, participant.createdAt);

  return res.status(201).json({ id: participant.id, name: participant.name });
});

app.post("/api/boards/:code/tasks", (req, res) => {
  const board = getBoardByCode(req.params.code);
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }

  const parsed = createTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxPosition = db
    .prepare("SELECT COALESCE(MAX(position), -1) as maxPosition FROM tasks WHERE board_id = ? AND state = ?")
    .get(board.id, parsed.data.state) as { maxPosition: number };

  const assignees = parsed.data.assigneeIds;

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (id, board_id, title, description, state, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      board.id,
      parsed.data.title,
      parsed.data.description,
      parsed.data.state,
      maxPosition.maxPosition + 1,
      now,
      now
    );

    if (assignees.length > 0) {
      const participantCount = db
        .prepare(
          `SELECT COUNT(1) as count FROM participants
           WHERE board_id = ? AND id IN (${assignees.map(() => "?").join(",")})`
        )
        .get(board.id, ...assignees) as { count: number };

      if (participantCount.count !== assignees.length) {
        throw new Error("One or more assignees do not belong to this board");
      }

      const insertAssignment = db.prepare(
        "INSERT INTO task_participants (task_id, participant_id) VALUES (?, ?)"
      );

      for (const assigneeId of assignees) {
        insertAssignment.run(taskId, assigneeId);
      }
    }
  });

  try {
    transaction();
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
  }

  return res.status(201).json({ id: taskId });
});

app.patch("/api/boards/:code/tasks/:taskId", (req, res) => {
  const board = getBoardByCode(req.params.code);
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }

  const parsed = updateTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const task = db
    .prepare("SELECT id, state FROM tasks WHERE id = ? AND board_id = ?")
    .get(req.params.taskId, board.id) as { id: string; state: TaskState } | undefined;

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  const nextState = parsed.data.state ?? task.state;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    if (parsed.data.title || parsed.data.description !== undefined || parsed.data.state) {
      let nextPosition: number | null = null;

      if (parsed.data.state && parsed.data.state !== task.state) {
        const maxPosition = db
          .prepare(
            "SELECT COALESCE(MAX(position), -1) as maxPosition FROM tasks WHERE board_id = ? AND state = ?"
          )
          .get(board.id, parsed.data.state) as { maxPosition: number };
        nextPosition = maxPosition.maxPosition + 1;
      }

      db.prepare(
        `UPDATE tasks
         SET title = COALESCE(?, title),
             description = COALESCE(?, description),
             state = ?,
             position = COALESCE(?, position),
             updated_at = ?
         WHERE id = ? AND board_id = ?`
      ).run(parsed.data.title ?? null, parsed.data.description ?? null, nextState, nextPosition, now, task.id, board.id);
    }

    if (parsed.data.assigneeIds) {
      const assignees = parsed.data.assigneeIds;

      if (assignees.length > 0) {
        const participantCount = db
          .prepare(
            `SELECT COUNT(1) as count FROM participants
             WHERE board_id = ? AND id IN (${assignees.map(() => "?").join(",")})`
          )
          .get(board.id, ...assignees) as { count: number };

        if (participantCount.count !== assignees.length) {
          throw new Error("One or more assignees do not belong to this board");
        }
      }

      db.prepare("DELETE FROM task_participants WHERE task_id = ?").run(task.id);
      const insertAssignment = db.prepare(
        "INSERT INTO task_participants (task_id, participant_id) VALUES (?, ?)"
      );

      for (const assigneeId of assignees) {
        insertAssignment.run(task.id, assigneeId);
      }
    }
  });

  try {
    tx();
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
  }

  return res.status(200).json({ ok: true });
});

app.delete("/api/boards/:code/tasks/:taskId", (req, res) => {
  const board = getBoardByCode(req.params.code);
  if (!board) {
    return res.status(404).json({ error: "Board not found" });
  }

  const result = db.prepare("DELETE FROM tasks WHERE id = ? AND board_id = ?").run(req.params.taskId, board.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.status(204).send();
});

const server = app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing process or run with another PORT.`);
    process.exit(1);
  }

  console.error("API startup failed:", error.message);
  process.exit(1);
});
