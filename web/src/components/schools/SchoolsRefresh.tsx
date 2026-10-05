"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Recheck eligibility when returning to a tab or a browser-history page. */
export function SchoolsRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    // App Router can reactivate an eligible page from history without pageshow.
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
