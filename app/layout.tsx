import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "muses",
  description:
    "Turn a design book into a playable practice game with decisions, feedback, and page references.",
  openGraph: {
    title: "muses",
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
