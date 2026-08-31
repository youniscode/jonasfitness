import "./progress.css";

export const dynamic = "force-dynamic";

// Public layout for everything under /progress — including the pre-auth
// /progress/founding offer page. Product pages (/(product)) add their own
// server-side auth + paywall guard.
export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}