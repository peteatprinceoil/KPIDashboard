import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prince Oil · CFO Briefing",
  description: "Daily KPI dashboard for Prince Oil",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
