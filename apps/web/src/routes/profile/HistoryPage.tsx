import { useQuery } from "@tanstack/react-query";
import type { HealthRecordEntryType, RecordEntry, StoredScoreSnapshot } from "@kkd/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { listHealthRecords, listRecordEntries, listRecordScores } from "../../features/records";

const ENTRY_TYPE_ORDER: HealthRecordEntryType[] = [
  "symptom",
  "measurement",
  "medication_report",
  "checkin",
  "note",
];

function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function labeledField(
  t: (key: string, options: { defaultValue: string }) => string,
  prefix: "history.entryType" | "history.score" | "history.value",
  key: string,
): string {
  return t(`${prefix}.${key}`, { defaultValue: key });
}

function formatValueJson(
  value: Record<string, unknown> | undefined,
  t: (key: string, options: { defaultValue: string }) => string,
): string | null {
  if (!value) {
    return null;
  }
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) {
      continue;
    }
    const label = labeledField(t, "history.value", key);
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      parts.push(`${label}: ${raw}`);
    } else {
      parts.push(`${label}: ${JSON.stringify(raw)}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function compareEntries(a: RecordEntry, b: RecordEntry): number {
  const byEffective = b.effectiveAt.localeCompare(a.effectiveAt);
  if (byEffective !== 0) {
    return byEffective;
  }
  return b.createdAt.localeCompare(a.createdAt);
}

function groupEntries(entries: RecordEntry[]): { heading: HealthRecordEntryType | "all"; items: RecordEntry[] }[] {
  const types = new Set(entries.map((entry) => entry.entryType));
  if (types.size <= 1) {
    return [{ heading: "all", items: [...entries].sort(compareEntries) }];
  }
  return ENTRY_TYPE_ORDER.filter((type) => types.has(type)).map((type) => ({
    heading: type,
    items: entries.filter((entry) => entry.entryType === type).sort(compareEntries),
  }));
}

function EntryRow({
  entry,
  locale,
  showType,
}: {
  entry: RecordEntry;
  locale: string;
  showType: boolean;
}) {
  const { t } = useTranslation();
  const typeLabel = labeledField(t, "history.entryType", entry.entryType);
  const values = formatValueJson(entry.valueJson, t);
  const headline = entry.patientWording ?? entry.conceptCode ?? typeLabel;
  const conceptLabel =
    entry.patientWording && entry.conceptCode
      ? t(`history.concept.${entry.conceptCode}`, { defaultValue: "" })
      : "";
  return (
    <article className="ehr-row">
      <time dateTime={entry.effectiveAt}>{formatWhen(entry.effectiveAt, locale)}</time>
      <div>
        <p>{showType ? `${typeLabel} — ${headline}` : headline}</p>
        {conceptLabel ? <p>{conceptLabel}</p> : null}
        {values ? <p>{values}</p> : null}
      </div>
    </article>
  );
}

function ScoreRow({
  field,
  value,
  note,
}: {
  field: string;
  value?: string | number;
  note: string;
}) {
  return (
    <div className="ehr-row">
      <span>{field}</span>
      <div>
        {value !== undefined ? <p>{value}</p> : null}
        <p>{note}</p>
      </div>
    </div>
  );
}

function SystemScoreChart({ score, locale }: { score: StoredScoreSnapshot; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="ehr-chart">
      <ScoreRow
        field={labeledField(t, "history.score", "urgencyClass")}
        value={score.urgencyClass}
        note={score.explanations.urgencyClass}
      />
      <ScoreRow
        field={labeledField(t, "history.score", "completenessPercent")}
        value={score.completenessPercent}
        note={score.explanations.completenessPercent}
      />
      <ScoreRow
        field={labeledField(t, "history.score", "trajectory")}
        value={score.trajectory}
        note={score.explanations.trajectory}
      />
      <ScoreRow
        field={labeledField(t, "history.score", "severityReported")}
        value={score.severityReported}
        note={score.explanations.severityReported}
      />
      <div className="ehr-row">
        <span>{labeledField(t, "history.score", "algorithmVersion")}</span>
        <div>
          <p>{score.algorithmVersion}</p>
          <time dateTime={score.generatedAt}>{formatWhen(score.generatedAt, locale)}</time>
        </div>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
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
  const entries = entriesQuery.data ?? [];
  const groups = groupEntries(entries);

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

      {recordId && entriesQuery.isSuccess && entries.length === 0 ? <p>{t("history.empty")}</p> : null}

      {entries.length > 0 ? (
        <section className="voice-card">
          <h2>{groups.length > 1 ? t("records.ehrTitle") : t("history.entries")}</h2>
          {groups.map((group) => (
            <div className="ehr-chart" key={group.heading}>
              {group.heading === "all" ? null : (
                <h3>{labeledField(t, "history.entryType", group.heading)}</h3>
              )}
              {group.items.map((entry) => (
                <EntryRow
                  entry={entry}
                  key={entry.id}
                  locale={locale}
                  showType={group.heading === "all"}
                />
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {latestScore ? (
        <section className="voice-card">
          <h2>{t("history.scores")}</h2>
          <p>{t("history.notADiagnosis")}</p>
          <SystemScoreChart locale={locale} score={latestScore} />
        </section>
      ) : null}
    </main>
  );
}
