import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import Script from "next/script";
import { POP_GUARD_SCRIPT } from "./_shell/pop-guard";
import "./globals.css";

const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], variable: "--font-montserrat", display: "swap" });

export const metadata: Metadata = {
  title: "Miljonmatch",
  description: "Miljonbemannings plattform för arbetsmarknadsinsatser",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv" className={montserrat.variable}>
      <body>
        {children}
        {/* Tillbaka/framåt efter en omladdning: före Nexts egen lyssnare (src/app/_shell/pop-guard.ts). */}
        <Script id="mm-pop-guard" strategy="beforeInteractive">
          {POP_GUARD_SCRIPT}
        </Script>
      </body>
    </html>
  );
}
