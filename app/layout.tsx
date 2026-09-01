import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import PwaRegister from "./PwaRegister";
import AttributionCapture from "./AttributionCapture";
import "./globals.css";
import "./live-session.css";
import "./live-session-phase2.css";
import "./live-session-phase3.css";
import "./live-session-phase4.css";
import "./client-workout.css";
import "./programme-builder.css";
import "./progression-engine.css";
import "./history-acquisition.css";
import "./lead-pipeline.css";
import "./coach-command-center.css";
import "./coach-notifications.css";
import "./onboarding-v2.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://jonasprogress.com"),
  title: {
    default: "Jonas Progress | Stop guessing. Beat the logbook.",
    template: "%s · Jonas Progress",
  },
  description: "Jonas Progress is self-directed training software: see what you did last time, set what you want to beat today, and record what you actually achieved.",
  applicationName: "Jonas Progress",
  icons: { icon: "/icon", apple: "/icon", shortcut: "/favicon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Jonas Progress" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Jonas Progress",
    title: "Jonas Progress | Stop guessing. Beat the logbook.",
    description: "Jonas Progress is self-directed training software: see what you did last time, set what you want to beat today, and record what you actually achieved.",
    url: "https://jonasprogress.com",
    locale: "fr_FR",
    alternateLocale: ["en_US", "ar_AR"],
  },
  twitter: {
    card: "summary",
    title: "Jonas Progress | Stop guessing. Beat the logbook.",
    description: "Jonas Progress is self-directed training software: see what you did last time, set what you want to beat today, and record what you actually achieved.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={geistSans.variable + " " + geistMono.variable}><ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/client" signUpFallbackRedirectUrl="/client" afterSignOutUrl="/"><PwaRegister /><AttributionCapture />{children}</ClerkProvider></body></html>;
}
