import { useEffect, useState } from "react";
import type { ReportedSymptom, UrgencyClass } from "@kkd/contracts";

export interface CareContext {
  sessionId: string | null;
  urgency: UrgencyClass;
  reportedSymptoms: ReportedSymptom[];
  isLoading: boolean;
}

/**
 * Pull the urgency + reported symptoms that care routing depends on from the
 * active session, rather than hardcoding them.
 *
 * Urgency comes from Antonia's severity engine via the session summary
 * (spec 8.2); this hook never computes or guesses it. Until that endpoint
 * lands, an unavailable session yields `unknown`, which routes to primary_care
 * - the conservative default - instead of silently implying low urgency.
 */
export function useCareContext(sessionId: string | null): CareContext {
  const [urgency, setUrgency] = useState<UrgencyClass>("unknown");
  const [reportedSymptoms, setReportedSymptoms] = useState<ReportedSymptom[]>([]);
  // Derived from the session id so no effect has to set it synchronously.
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const isLoading = Boolean(sessionId) && loadedSessionId !== sessionId;

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let cancelled = false;

    fetch(`/api/v1/sessions/${sessionId}/summary`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("unavailable"))))
      .then((data) => {
        if (cancelled) return;
        setUrgency((data?.safety?.urgency as UrgencyClass) ?? "unknown");
        setReportedSymptoms((data?.symptoms as ReportedSymptom[]) ?? []);
      })
      .catch(() => {
        // Session summary unavailable: stay at "unknown" rather than assuming
        // a low urgency class.
        if (!cancelled) {
          setUrgency("unknown");
          setReportedSymptoms([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedSessionId(sessionId);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { sessionId, urgency, reportedSymptoms, isLoading };
}
