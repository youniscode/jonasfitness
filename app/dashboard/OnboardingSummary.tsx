"use client";

import { useEffect, useState } from "react";

type Client = { id: number; name: string };
type Intake = { preferredLanguage: string; trainingExperience: string; availability: string; equipment: string; goalsDetail: string; trainingConsiderations: string; consentAt: string; updatedAt: string };

export default function OnboardingSummary({ client }: { client: Client }) {
  const [intake, setIntake] = useState<Intake | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (client.id < 1) return;
    let active = true;
    void fetch("/api/client-onboarding?clientId=" + client.id).then((response) => response.json().catch(() => ({}))).then((data) => { if (active) { setIntake(data.intake ?? null); setLoading(false); } }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client.id]);
  if (client.id < 1 || loading) return null;
  if (!intake) return <section className="coach-onboarding-summary pending"><div><p>CLIENT ONBOARDING</p><h2>Waiting for {client.name}.</h2><span>Send the client portal link after saving their sign-in email. Their answers will appear here.</span></div><i>○</i></section>;
  return <section className="coach-onboarding-summary"><div className="coach-onboarding-head"><div><p>CLIENT ONBOARDING · COMPLETE</p><h2>Ready to programme.</h2></div><span>{intake.preferredLanguage.toUpperCase()}</span></div><div className="coach-onboarding-grid"><article><small>EXPERIENCE</small><strong>{intake.trainingExperience}</strong></article><article><small>AVAILABILITY</small><strong>{intake.availability}</strong></article><article><small>EQUIPMENT</small><strong>{intake.equipment || "Not specified"}</strong></article></div><div className="coach-onboarding-notes"><div><small>CLIENT PRIORITIES</small><p>{intake.goalsDetail}</p></div>{intake.trainingConsiderations && <div><small>TRAINING CONSIDERATIONS</small><p>{intake.trainingConsiderations}</p></div>}</div></section>;
}
