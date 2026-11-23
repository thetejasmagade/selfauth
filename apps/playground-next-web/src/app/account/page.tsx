import { RequireAuth } from "../../auth-client/index.ts";
import { AccountScreen } from "../../screens/AccountScreen.tsx";

export default function Page() {
  return (
    <RequireAuth>
      <AccountScreen />
    </RequireAuth>
  );
}
