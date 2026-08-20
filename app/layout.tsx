import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobKreators Sourcing Console",
  description: "Source ranked candidates with phone numbers from a job description.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
