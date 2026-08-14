import PulseClient from "./PulseClient";

export const dynamic = "force-dynamic";

export default async function PulsePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PulseClient token={token} />;
}
