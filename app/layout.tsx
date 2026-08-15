import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import PwaRegister from "./PwaRegister";
import "./globals.css";
import "./live-session.css";
import "./live-session-phase2.css";
import "./live-session-phase3.css";
import "./live-session-phase4.css";
import "./client-workout.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jonas Fitness | Worldwide personal coaching",
  description: "Human-led personal coaching with intelligent training, progress and nutrition tracking for clients worldwide.",
  icons: { icon: "/icon", apple: "/icon", shortcut: "/favicon.svg" },
  applicationName: "Jonas Fitness",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Jonas Fitness" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={geistSans.variable + " " + geistMono.variable}><ClerkProvider><PwaRegister />{children}</ClerkProvider></body></html>;
}
