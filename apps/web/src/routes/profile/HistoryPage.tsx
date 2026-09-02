import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { listHealthRecords, listRecordEntries, listRecordScores } from "../../features/records";

export function HistoryPage() {
  const { t } = useTranslation();
  const recordsQuery = useQuery({
    queryKey: ["health-records"],
    queryFn: listHealthRecords,
  });

  const recordId = recordsQuery.data?.[0]?.id;
  const entriesQuery = useQuery({
    queryKey: ["health-record-entries", recordId],
    queryFn: () => listRecordEntries(recordId as string),
    enabled: Boolean(recordId),
  });
  const scoresQuery = useQuery({
    queryKey: ["health-record-scores", recordId],
    queryFn: () => listRecordScores(recordId as string),
    enabled: Boolean(recordId),
  });

  const latestScore = scoresQuery.data?.[scoresQuery.data.length - 1];

  return (
    <main>
      <p className="voice-kicker">
        <Link to="/">{t("voice.home")}</Link>
        {" · "}
        <Link to="/settings/privacy">{t("privacy.settings")}</Link>
      </p>
      <h1>{t("history.title")}</h1>
      <p>{t("history.notADiagnosis")}</p>

      {recordsQuery.isError || entriesQuery.isError || scoresQuery.isError ? (
        <p role="alert">{t("error.retry")}</p>
      ) : null}

      {recordsQuery.isLoading ? <p>{t("records.saving")}</p> : null}

      {!recordId && !recordsQuery.isLoading ? <p>{t("history.empty")}</p> : null}

      {entriesQuery.data && entriesQuery.data.length > 0 ? (
        <section className="voice-card">
          <h2>{t("history.entries")}</h2>
          <ol className="history-list">
            {entriesQuery.data.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.effectiveAt.slice(0, 10)}</strong>
                {" — "}
                {entry.patientWording ?? entry.conceptCode ?? entry.entryType}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {latestScore ? (
        <section className="voice-card">
          <h2>{t("history.scores")}</h2>
          <p>{latestScore.explanations.urgencyClass}</p>
          <p>{latestScore.explanations.completenessPercent}</p>
          <p>{latestScore.explanations.trajectory}</p>
          <p>{latestScore.explanations.severityReported}</p>
        </section>
      ) : null}
    </main>
  );
}
