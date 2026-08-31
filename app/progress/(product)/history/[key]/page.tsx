import HistoryPanel from "../HistoryPanel";

export default async function HistoryDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key;
  return <HistoryPanel initialKey={key} />;
}