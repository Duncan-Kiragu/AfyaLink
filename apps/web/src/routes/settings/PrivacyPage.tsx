import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  deleteAllHealthRecords,
  deleteHealthRecord,
  downloadExportBundle,
  exportRecordJson,
  listHealthRecords,
} from "../../features/records";

function triggerJsonDownload(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PrivacyPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const recordsQuery = useQuery({
    queryKey: ["health-records"],
    queryFn: listHealthRecords,
  });
  const record = recordsQuery.data?.[0];

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!record) {
        throw new Error("no_record");
      }
      const job = await exportRecordJson(record.id);
      if (!job.downloadPath) {
        throw new Error("no_download");
      }
      const bundle = await downloadExportBundle(job.downloadPath);
      triggerJsonDownload(`kkd-record-${record.id}.json`, bundle);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mode: "one" | "all") => {
      if (mode === "all") {
        await deleteAllHealthRecords();
        return;
      }
      if (!record) {
        throw new Error("no_record");
      }
      await deleteHealthRecord(record.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["health-records"] });
    },
  });

  return (
    <main>
      <p className="voice-kicker">
        <Link to="/">{t("voice.home")}</Link>
        {" · "}
        <Link to="/profile/history">{t("history.title")}</Link>
      </p>
      <h1>{t("privacy.settings")}</h1>
      <p>{t("privacy.consentNote")}</p>

      {recordsQuery.isError || exportMutation.isError || deleteMutation.isError ? (
        <p role="alert">{t("error.retry")}</p>
      ) : null}
      {recordsQuery.isLoading ? <p>{t("records.saving")}</p> : null}
      {!record && !recordsQuery.isLoading ? <p>{t("privacy.noRecords")}</p> : null}

      <div className="voice-actions">
        <button
          className="voice-btn voice-btn-primary"
          type="button"
          disabled={!record || exportMutation.isPending}
          onClick={() => void exportMutation.mutateAsync()}
        >
          {t("privacy.exportJson")}
        </button>
        <button
          className="voice-btn voice-btn-ghost"
          type="button"
          disabled={!record || deleteMutation.isPending}
          onClick={() => {
            if (window.confirm(t("privacy.deleteConfirm"))) {
              void deleteMutation.mutateAsync("one");
            }
          }}
        >
          {t("privacy.deleteRecord")}
        </button>
        <button
          className="voice-btn voice-btn-ghost"
          type="button"
          disabled={!record || deleteMutation.isPending}
          onClick={() => {
            if (window.confirm(t("privacy.deleteAllConfirm"))) {
              void deleteMutation.mutateAsync("all");
            }
          }}
        >
          {t("privacy.deleteAll")}
        </button>
      </div>
      {exportMutation.isSuccess ? <p>{t("privacy.exported")}</p> : null}
      {deleteMutation.isSuccess ? <p>{t("privacy.deleted")}</p> : null}
    </main>
  );
}
