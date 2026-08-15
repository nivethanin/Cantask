# CanTask MVP

Simple kanban board app with shareable 6-character board codes.

## What is implemented

- Create a board and receive a 6-character code.
- Join a board by code.
- Three task states: `planned`, `working_on`, `done`.
- Add participants (name-only, no login).
- Assign multiple participants to a task with a running chip list.
- Drag and drop tasks between states.
- Task descriptions with an on-screen task detail panel.
- Mobile-friendly and desktop-friendly responsive UI.
- Backend persistence with SQLite.

## Tech stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: SQLite (`better-sqlite3`)

## Run locally

1. Install dependencies:

```bash
npm install --cache .npm-cache
```

2. Start both apps:

```bash
npm run dev
```

This command auto-cleans stale API processes on ports `4000` and `4001` before starting the app.

3. Open the frontend:

- `http://localhost:5173`

4. API base URL (default):

- `http://localhost:4001/api`

## App structure

- `apps/web` - React frontend
- `apps/api` - Express API

## API overview

- `POST /api/boards` - create board
- `GET /api/boards/:code` - fetch board with tasks and assignees
- `POST /api/boards/:code/participants` - add or reuse participant by name
- `POST /api/boards/:code/tasks` - create task
- `PATCH /api/boards/:code/tasks/:taskId` - update task title/state/assignees
- `DELETE /api/boards/:code/tasks/:taskId` - delete task

## Notes

- Board code currently grants full edit access (MVP decision).
- Realtime sync is not implemented yet; the UI polls every 4 seconds.

## Troubleshooting

- If you still see a port conflict, run:

```bash
npm run dev:clean
```

- You can also override the API port manually:

```bash
PORT=4010 npm run dev --workspace @cantask/api
```
