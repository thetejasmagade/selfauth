import { GuestOnly } from "../../auth-client/index.ts";
import { RegisterScreen } from "../../screens/auth/RegisterScreen.tsx";

export default function Page() {
  return (
    <GuestOnly home="/account">
      <RegisterScreen />
    </GuestOnly>
  );
}
