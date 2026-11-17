import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError, useAuth } from "../auth/index.ts";

interface Note {
  id: string;
  text: string;
  ownerId: string;
}

export function NotesPage() {
  const { client } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setNotes((await client.api<{ notes: Note[] }>("GET", "/api/notes")).notes);
  }, [client]);

  useEffect(() => {
    load().catch((e: unknown) => setError(describeError(e)));
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await client.api("POST", "/api/notes", { text });
      setText("");
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <>
      <h1>Notes</h1>
      <form onSubmit={(e) => void add(e)}>
        <label>
          New note{" "}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            name="text"
            required
            maxLength={2000}
          />
        </label>
        <button type="submit">Add note</button>
      </form>
      {error && (
        <p role="alert">
          {error}
        </p>
      )}
      <ul data-testid="notes">
        {notes.map((note) => (
          <li key={note.id}>
            {note.text}
          </li>
        ))}
      </ul>
      {notes.length === 0 && <p>No notes yet.</p>}
    </>
  );
}
