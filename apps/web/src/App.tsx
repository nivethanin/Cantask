import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

type TaskState = "planned" | "working_on" | "done";

type Participant = {
  id: string;
  name: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  state: TaskState;
  assignees: Participant[];
};

type BoardPayload = {
  code: string;
  name: string;
  participants: Participant[];
  tasks: Task[];
};

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const stateLabels: Record<TaskState, string> = {
  planned: "Planned",
  working_on: "Working On",
  done: "Done"
};

const stateOrder: TaskState[] = ["planned", "working_on", "done"];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function LandingPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createBoard(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const board = await api<{ code: string }>("/boards", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "Untitled Board" })
      });
      navigate(`/board/${board.code}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create board");
    } finally {
      setLoading(false);
    }
  }

  function joinBoard(event: FormEvent) {
    event.preventDefault();
    const normalized = joinCode.trim().toUpperCase();
    if (normalized.length !== 6) {
      setError("Board code must be exactly 6 characters.");
      return;
    }
    navigate(`/board/${normalized}`);
  }

  return (
    <main className="landing-shell">
      <section className="hero-card">
        <p className="eyebrow">CanTask</p>
        <h1>Simple boards. Fast teamwork.</h1>
        <p className="subtitle">
          Create a board and share its 6-letter code. Open it on desktop or phone and keep work moving.
        </p>
        <form onSubmit={createBoard} className="stacked-form">
          <label>
            Board name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sprint Planning"
              maxLength={80}
            />
          </label>
          <button disabled={loading} type="submit">
            {loading ? "Creating..." : "Create Board"}
          </button>
        </form>
        <form onSubmit={joinBoard} className="inline-form">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
          />
          <button type="submit">Join</button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}

function BoardPage() {
  const { code = "" } = useParams();
  const normalizedCode = code.toUpperCase();

  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskState, setTaskState] = useState<TaskState>("planned");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [createAssigneeCandidate, setCreateAssigneeCandidate] = useState("");
  const [participantName, setParticipantName] = useState("");

  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverState, setDragOverState] = useState<TaskState | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailState, setDetailState] = useState<TaskState>("planned");
  const [detailAssigneeIds, setDetailAssigneeIds] = useState<string[]>([]);
  const [detailAssigneeCandidate, setDetailAssigneeCandidate] = useState("");

  const selectedTask = useMemo(
    () => board?.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [board, selectedTaskId]
  );

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    setDetailTitle(selectedTask.title);
    setDetailDescription(selectedTask.description);
    setDetailState(selectedTask.state);
    setDetailAssigneeIds(selectedTask.assignees.map((person) => person.id));
    setDetailAssigneeCandidate("");
  }, [selectedTask]);

  async function loadBoard() {
    try {
      const payload = await api<BoardPayload>(`/boards/${normalizedCode}`);
      setBoard(payload);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load board");
    }
  }

  useEffect(() => {
    void loadBoard();
    const timer = window.setInterval(() => {
      void loadBoard();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [normalizedCode]);

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskState, Task[]> = {
      planned: [],
      working_on: [],
      done: []
    };

    for (const task of board?.tasks ?? []) {
      groups[task.state].push(task);
    }
    return groups;
  }, [board]);

  if (error && !board) {
    return (
      <main className="board-shell">
        <p className="error-text">{error}</p>
      </main>
    );
  }

  if (!board) {
    return (
      <main className="board-shell">
        <p>Loading board...</p>
      </main>
    );
  }

  const boardCode = board.code;

  async function createParticipant(event: FormEvent) {
    event.preventDefault();
    if (!participantName.trim()) {
      return;
    }

    try {
      await api(`/boards/${boardCode}/participants`, {
        method: "POST",
        body: JSON.stringify({ name: participantName })
      });
      setParticipantName("");
      await loadBoard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add participant");
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) {
      return;
    }

    try {
      await api(`/boards/${boardCode}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          state: taskState,
          assigneeIds: selectedAssignees
        })
      });

      setTaskTitle("");
      setTaskDescription("");
      setSelectedAssignees([]);
      setCreateAssigneeCandidate("");
      setTaskState("planned");
      await loadBoard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create task");
    }
  }

  async function patchTask(taskId: string, payload: Record<string, unknown>) {
    await api(`/boards/${boardCode}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  async function moveTask(taskId: string, nextState: TaskState) {
    if (!board) {
      return;
    }

    const current = board.tasks.find((task) => task.id === taskId);
    if (!current || current.state === nextState) {
      return;
    }

    try {
      await patchTask(taskId, { state: nextState });
      await loadBoard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not move task");
    }
  }

  async function deleteTask(taskId: string) {
    try {
      await api(`/boards/${boardCode}/tasks/${taskId}`, {
        method: "DELETE"
      });
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      await loadBoard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete task");
    }
  }

  async function saveTaskDetails() {
    if (!selectedTask) {
      return;
    }

    try {
      await patchTask(selectedTask.id, {
        title: detailTitle,
        description: detailDescription,
        state: detailState,
        assigneeIds: detailAssigneeIds
      });
      await loadBoard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save task details");
    }
  }

  function onTaskCardKey(event: KeyboardEvent<HTMLDivElement>, taskId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedTaskId(taskId);
    }
  }

  function toggleCreateAssignee(participantId: string) {
    setSelectedAssignees((current) => {
      if (current.includes(participantId)) {
        return current;
      }
      return [...current, participantId];
    });
    setCreateAssigneeCandidate("");
  }

  function removeCreateAssignee(participantId: string) {
    setSelectedAssignees((current) => current.filter((id) => id !== participantId));
  }

  function addDetailAssignee(participantId: string) {
    setDetailAssigneeIds((current) => {
      if (current.includes(participantId)) {
        return current;
      }
      return [...current, participantId];
    });
    setDetailAssigneeCandidate("");
  }

  function removeDetailAssignee(participantId: string) {
    setDetailAssigneeIds((current) => current.filter((id) => id !== participantId));
  }

  const createSelectedPeople = board.participants.filter((person) => selectedAssignees.includes(person.id));
  const createCandidatePeople = board.participants.filter((person) => !selectedAssignees.includes(person.id));

  const detailSelectedPeople = board.participants.filter((person) => detailAssigneeIds.includes(person.id));
  const detailCandidatePeople = board.participants.filter((person) => !detailAssigneeIds.includes(person.id));

  return (
    <main className="board-shell">
      <header className="board-header">
        <div>
          <p className="eyebrow">Board Code</p>
          <h1>{board.name}</h1>
          <p className="code-chip">{board.code}</p>
        </div>
        <button type="button" onClick={() => void loadBoard()}>
          Refresh
        </button>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="toolbox-grid">
        <form className="tool-card" onSubmit={createParticipant}>
          <h2>Add Participant</h2>
          <div className="inline-form">
            <input
              value={participantName}
              onChange={(event) => setParticipantName(event.target.value)}
              placeholder="Alex"
              maxLength={40}
            />
            <button type="submit">Add</button>
          </div>
          <div className="chip-row">
            {board.participants.map((participant) => (
              <span className="chip" key={participant.id}>
                {participant.name}
              </span>
            ))}
          </div>
        </form>

        <form className="tool-card" onSubmit={createTask}>
          <h2>Create Task</h2>
          <input
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder="Write release notes"
            maxLength={160}
          />
          <textarea
            value={taskDescription}
            onChange={(event) => setTaskDescription(event.target.value)}
            placeholder="Describe the task details"
            maxLength={4000}
            rows={4}
          />
          <select value={taskState} onChange={(event) => setTaskState(event.target.value as TaskState)}>
            {stateOrder.map((state) => (
              <option key={state} value={state}>
                {stateLabels[state]}
              </option>
            ))}
          </select>

          <div className="assignee-picker">
            <p className="picker-title">Assigned</p>
            <div className="inline-form">
              <select
                value={createAssigneeCandidate}
                onChange={(event) => setCreateAssigneeCandidate(event.target.value)}
              >
                <option value="">Select participant</option>
                {createCandidatePeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (createAssigneeCandidate) {
                    toggleCreateAssignee(createAssigneeCandidate);
                  }
                }}
              >
                Add
              </button>
            </div>
            <div className="chip-row">
              {createSelectedPeople.map((person) => (
                <button
                  type="button"
                  className="chip removable-chip"
                  key={person.id}
                  onClick={() => removeCreateAssignee(person.id)}
                >
                  {person.name} ×
                </button>
              ))}
            </div>
          </div>

          <button type="submit">Add Task</button>
        </form>
      </section>

      <section className="columns-wrap" aria-label="Kanban columns">
        {stateOrder.map((state) => (
          <article
            className={`column ${dragOverState === state ? "column-drop-target" : ""}`}
            key={state}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverState(state);
            }}
            onDragLeave={() => {
              setDragOverState((current) => (current === state ? null : current));
            }}
            onDrop={(event) => {
              event.preventDefault();
              const droppedTaskId = event.dataTransfer.getData("text/plain") || dragTaskId;
              setDragOverState(null);
              setDragTaskId(null);
              if (droppedTaskId) {
                void moveTask(droppedTaskId, state);
              }
            }}
          >
            <h2>{stateLabels[state]}</h2>
            {groupedTasks[state].map((task) => (
              <div
                className="task-card task-draggable"
                key={task.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", task.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDragTaskId(task.id);
                }}
                onDragEnd={() => {
                  setDragTaskId(null);
                  setDragOverState(null);
                }}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTaskId(task.id)}
                onKeyDown={(event) => onTaskCardKey(event, task.id)}
              >
                <div className="task-head">
                  <h3>{task.title}</h3>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteTask(task.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
                <p className="task-preview">{task.description || "No description yet."}</p>
                <div className="chip-row">
                  {task.assignees.map((person) => (
                    <span className="chip" key={person.id}>
                      {person.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {groupedTasks[state].length === 0 ? <p className="empty-column">No tasks yet.</p> : null}
          </article>
        ))}
      </section>

      {selectedTask ? (
        <div className="detail-overlay" onClick={() => setSelectedTaskId(null)}>
          <aside className="detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="detail-header">
              <h2>Task Details</h2>
              <button type="button" onClick={() => setSelectedTaskId(null)}>
                Close
              </button>
            </div>

            <label>
              Title
              <input value={detailTitle} onChange={(event) => setDetailTitle(event.target.value)} maxLength={160} />
            </label>

            <label>
              Description
              <textarea
                value={detailDescription}
                onChange={(event) => setDetailDescription(event.target.value)}
                rows={8}
                maxLength={4000}
              />
            </label>

            <label>
              State
              <select value={detailState} onChange={(event) => setDetailState(event.target.value as TaskState)}>
                {stateOrder.map((state) => (
                  <option key={state} value={state}>
                    {stateLabels[state]}
                  </option>
                ))}
              </select>
            </label>

            <div className="assignee-picker">
              <p className="picker-title">Assigned</p>
              <div className="inline-form">
                <select
                  value={detailAssigneeCandidate}
                  onChange={(event) => setDetailAssigneeCandidate(event.target.value)}
                >
                  <option value="">Select participant</option>
                  {detailCandidatePeople.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (detailAssigneeCandidate) {
                      addDetailAssignee(detailAssigneeCandidate);
                    }
                  }}
                >
                  Add
                </button>
              </div>
              <div className="chip-row">
                {detailSelectedPeople.map((person) => (
                  <button
                    type="button"
                    className="chip removable-chip"
                    key={person.id}
                    onClick={() => removeDetailAssignee(person.id)}
                  >
                    {person.name} ×
                  </button>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => void saveTaskDetails()}>
              Save Changes
            </button>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/board/:code" element={<BoardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
