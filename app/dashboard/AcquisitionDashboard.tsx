"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AcquisitionData = { total: number; tracked: number; topSource: string; sources: { source: string; count: number }[]; recent: { id: number; name: string; source: string; campaign: string; createdAt: string }[] };
const campaigns = [
  { label: "Instagram bio", source: "instagram", campaign: "instagram-profile" },
  { label: "TikTok bio", source: "tiktok", campaign: "tiktok-profile" },
  { label: "Facebook page", source: "facebook", campaign: "facebook-page" },
  { label: "WhatsApp", source: "whatsapp", campaign: "whatsapp-share" },
];

export default function AcquisitionDashboard() {
  const [data, setData] = useState<AcquisitionData | null>(null); const [notice, setNotice] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/acquisition"); if (response.ok) setData(await response.json()); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  // Roster changes (lead conversion, manual add, deletion) re-fetch the
  // acquisition summary immediately so counts, sources and recent clients
  // stay in sync without a full page reload. The manual Refresh button keeps
  // working independently.
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("jonas-clients-changed", refresh);
    return () => window.removeEventListener("jonas-clients-changed", refresh);
  }, [load]);
  const maximum = useMemo(() => Math.max(1, ...(data?.sources.map((source) => source.count) ?? [])), [data]);
  async function copyCampaign(source: string, campaign: string, label: string) { const url = `${window.location.origin}/?utm_source=${source}&utm_medium=social&utm_campaign=${campaign}`; try { await navigator.clipboard.writeText(url); setNotice(`${label} link copied.`); } catch { setNotice(url); } }
  return <section className="acquisition-dashboard" id="acquisition"><header><div><p>CLIENT ACQUISITION</p><h2>Know what brings people in.</h2><span>First-touch source tracking—private, first-party and free.</span></div><button className="refresh-button" onClick={() => void load()}>Refresh</button></header>{notice && <p className="acquisition-notice">✓ {notice}</p>}
    <div className="acquisition-layout"><article className="source-breakdown"><div className="acquisition-kpis"><span><small>CLIENTS</small><strong>{data?.total ?? 0}</strong></span><span><small>KNOWN SOURCE</small><strong>{data?.tracked ?? 0}</strong></span><span><small>TOP SOURCE</small><strong>{data?.topSource ?? "—"}</strong></span></div><div className="source-bars">{data?.sources.length ? data.sources.map((item) => <div key={item.source}><span><b>{item.source}</b><small>{item.count}</small></span><i><em style={{ width: `${Math.max(5, (item.count / maximum) * 100)}%` }}/></i></div>) : <p>No source data yet.</p>}</div></article>
      <article className="campaign-links"><small>TRACKED LINKS</small><h3>Use one link per channel.</h3><p>Google organic search is detected automatically. Copy these links into each social profile to identify the channel reliably.</p>{campaigns.map((campaign) => <button key={campaign.source} onClick={() => void copyCampaign(campaign.source, campaign.campaign, campaign.label)}><span><b>{campaign.label}</b><small>utm_source={campaign.source}</small></span><i>Copy ↗</i></button>)}</article></div>
    {data?.recent.length ? <div className="acquisition-recent"><small>RECENT CLIENTS</small>{data.recent.map((client) => <span key={client.id}><b>{client.name}</b><em>{client.source}{client.campaign ? ` · ${client.campaign}` : ""}</em><time>{new Date(client.createdAt).toLocaleDateString()}</time></span>)}</div> : null}
  </section>;
}
