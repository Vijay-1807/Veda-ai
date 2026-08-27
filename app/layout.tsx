import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Assessment Mapper | VedaAI",
  description: "Map question papers to handwritten answer sheets with AI.",
  icons: {
    icon: "/vedaai-logo.avif",
    shortcut: "/vedaai-logo.avif",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
