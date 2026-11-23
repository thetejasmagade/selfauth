import { Suspense } from "react";
import { GuestOnly } from "../../auth-client/index.ts";
import { LoginScreen } from "../../screens/auth/LoginScreen.tsx";

export default function Page() {
  // LoginScreen reads ?redirect=, which needs a Suspense boundary in a statically built page.
  return (
    <Suspense>
      <GuestOnly home="/notes">
        <LoginScreen />
      </GuestOnly>
    </Suspense>
  );
}
