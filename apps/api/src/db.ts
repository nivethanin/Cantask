import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "apps/api/data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "cantask.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    UNIQUE(board_id, name_normalized)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK(state IN ('planned', 'working_on', 'done')),
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_participants (
    task_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    PRIMARY KEY(task_id, participant_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_boards_code ON boards(code);
  CREATE INDEX IF NOT EXISTS idx_tasks_board_state_pos ON tasks(board_id, state, position);
  CREATE INDEX IF NOT EXISTS idx_participants_board ON participants(board_id);
`);

const boardColumns = db
  .prepare("PRAGMA table_info(boards)")
  .all() as Array<{ name: string }>;

if (!boardColumns.some((column) => column.name === "description")) {
  db.exec("ALTER TABLE boards ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}

const taskColumns = db
  .prepare("PRAGMA table_info(tasks)")
  .all() as Array<{ name: string }>;

if (!taskColumns.some((column) => column.name === "description")) {
  db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}
