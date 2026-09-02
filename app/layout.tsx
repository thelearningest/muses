import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playable Books",
  description:
    "Turn a design book into a playable practice game with decisions, feedback, and page references.",
  openGraph: {
    title: "Playable Books",
    description:
      "Turn a design book into a playable practice game with decisions, feedback, and page references.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
