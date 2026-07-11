import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The City of Misfit Things",
  description:
    "A six-quest design apprenticeship where confusing everyday objects become playable lessons.",
  openGraph: {
    title: "The City of Misfit Things",
    description:
      "Repair six museum artifacts and learn the principles of human-centered design.",
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
