"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { attributionStorageKey, sourceFromReferrer, sourceFromUtm, type Attribution } from "./lib/attribution";

const sentKey = "jonas:first-touch-sent:v1";

function readAttribution(): Attribution | null {
  try {
    const saved = localStorage.getItem(attributionStorageKey);
    if (saved) return JSON.parse(saved) as Attribution;
  } catch { /* storage may be unavailable in private browsing */ }
  return null;
}

function captureAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source") ?? "";
  const referrer = document.referrer ? (() => { try { return new URL(document.referrer).origin; } catch { return ""; } })() : "";
  return {
    source: utmSource ? sourceFromUtm(utmSource) : sourceFromReferrer(document.referrer),
    medium: (params.get("utm_medium") ?? (referrer ? "referral" : "direct")).slice(0, 80),
    campaign: (params.get("utm_campaign") ?? "").slice(0, 120),
    referrer: referrer.slice(0, 220),
    landingPage: `${window.location.pathname}${window.location.search}`.slice(0, 180),
  };
}

export default function AttributionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    let attribution = readAttribution();
    if (!attribution) {
      attribution = captureAttribution();
      try { localStorage.setItem(attributionStorageKey, JSON.stringify(attribution)); } catch { /* best effort */ }
    }
    let alreadySent = false;
    try { alreadySent = sessionStorage.getItem(sentKey) === "1"; } catch { /* best effort */ }
    if (!pathname.startsWith("/client") || alreadySent) return;
    const controller = new AbortController();
    void fetch("/api/client-attribution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attribution),
      signal: controller.signal,
    }).then((response) => {
      if (response.ok) { try { sessionStorage.setItem(sentKey, "1"); } catch { /* best effort */ } }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [pathname]);

  return null;
}
