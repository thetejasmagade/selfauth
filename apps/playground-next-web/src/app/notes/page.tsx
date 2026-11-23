import { RequireAuth } from "../../auth-client/index.ts";
import { NotesScreen } from "../../screens/NotesScreen.tsx";

export default function Page() {
  return (
    <RequireAuth>
      <NotesScreen />
    </RequireAuth>
  );
}
