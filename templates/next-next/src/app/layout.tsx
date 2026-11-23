import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "./header.tsx";
import { Providers } from "./providers.tsx";

export const metadata: Metadata = {
  title: "SelfAuth Next.js playground",
  // Email links carry one-time tokens; never leak the URL to other sites (SEC-TOKEN-005).
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
