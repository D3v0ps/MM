import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
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
      <body>{children}</body>
    </html>
  );
}
