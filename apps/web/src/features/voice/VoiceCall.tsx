import { ConversationProvider, useConversationControls, useConversationStatus } from "@elevenlabs/react";
import "../../styles/voice.css";
import type { ConsultationSummary, ReportedSymptom, SafetyAssessment } from "@kkd/contracts";
import { type FormEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { computeRecordScore, ensureRecordForVoice, persistFactsFromVoice } from "../records";
import { VoiceOrb, type VoiceOrbMode } from "./VoiceOrb";
import {
  ackVoiceDisclosure,
  cancelInterviewCallback,
  closeVoiceSession,
  evaluateVoiceSafety,
  fetchNextQuestion,
  fetchVoiceDisclosure,
  fetchVoiceStatus,
  fetchVoiceSummary,
  reportMockCallStatus,
  requestInterviewCallback,
  requestSummarySms,
  startVoiceSession,
  submitVoiceAnswer,
} from "./voiceApi";

type CallPhase = "idle" | "disclosed" | "live" | "summary";

function stepIndex(phase: CallPhase): number {
  if (phase === "idle") {
    return 0;
  }
  if (phase === "summary") {
    return 2;
  }
  return 1;
}

function VoiceProgress({ phase }: { phase: CallPhase }) {
  const { t } = useTranslation();
  const current = stepIndex(phase);
  const labels = [t("voice.step.ready"), t("voice.step.live"), t("voice.step.summary")];

  return (
    <>
      <ol className="voice-sr-steps" aria-label={t("voice.stepsLabel")}>
        {labels.map((label, index) => (
          <li key={label} aria-current={index === current ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <p className="voice-hud-index" aria-hidden="true">
        <span>0{current + 1}</span>
        {labels[current]}
      </p>
    </>
  );
}

function onStagePointer(event: PointerEvent<HTMLElement>) {
  const x = event.clientX / window.innerWidth - 0.5;
  const y = event.clientY / window.innerHeight - 0.5;
  event.currentTarget.style.setProperty("--vx", x.toFixed(3));
  event.currentTarget.style.setProperty("--vy", y.toFixed(3));
}

function orbMode(args: { live: boolean; mock: boolean; listening?: boolean }): VoiceOrbMode {
  if (args.listening) {
    return "listening";
  }
  if (args.mock) {
    return "mock";
  }
  if (args.live) {
    return "ready";
  }
  return "idle";
}

function TechnicalFallback({ reason }: { reason?: string }) {
  const { t } = useTranslation();
  if (!reason) {
    return null;
  }
  return (
    <div className="voice-note">
      <p role="status">{t("voice.typedOnly")}</p>
      <details>
        <summary>{t("voice.technicalDetail")}</summary>
        <p>{t(`voice.liveFallback.${reason}`)}</p>
      </details>
    </div>
  );
}

function uniqueLines(items: string[], exclude?: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    const line = item.trim();
    if (!line || line === exclude || seen.has(line)) {
      continue;
    }
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

function labelUnknownFact(item: string, t: (key: string, options: { defaultValue: string }) => string): string {
  return t(`voice.field.${item}`, { defaultValue: item });
}

function RecordBlock({
  label,
  items,
  text,
}: {
  label: string;
  items?: string[];
  text?: string;
}) {
  if (text?.trim()) {
    return (
      <section className="voice-record-block">
        <h2 className="voice-record-label">{label}</h2>
        <p className="voice-copy">{text}</p>
      </section>
    );
  }
  if (!items || items.length === 0) {
    return null;
  }
  return (
    <section className="voice-record-block">
      <h2 className="voice-record-label">{label}</h2>
      <ul className="voice-facts">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function VoiceCallInner({ sessionIdRef }: { sessionIdRef: { current?: string } }) {
  const { t, i18n } = useTranslation();
  const [locale, setLocale] = useState(i18n.language.startsWith("sw") ? "sw" : "en");
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [disclosure, setDisclosure] = useState({ version: "", text: "" });
  const [sessionId, setSessionId] = useState<string>();
  const [transport, setTransport] = useState<"elevenlabs_webrtc" | "mock_browser">("mock_browser");
  const [liveFallbackReason, setLiveFallbackReason] = useState<string>();
  const [conversationToken, setConversationToken] = useState<string>();
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [safety, setSafety] = useState<SafetyAssessment>();
  const [summary, setSummary] = useState<ConsultationSummary>();
  const [error, setError] = useState<string>();
  const [phone, setPhone] = useState("");
  const [smsNote, setSmsNote] = useState<string>();
  const [callbackNote, setCallbackNote] = useState<string>();
  const [callbackRequested, setCallbackRequested] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saveCandidates, setSaveCandidates] = useState<ReportedSymptom[]>([]);
  const [selectedFactIds, setSelectedFactIds] = useState<string[]>([]);
  const [savingRecord, setSavingRecord] = useState(false);
  const [saveNote, setSaveNote] = useState<string>();
  const { startSession, endSession } = useConversationControls();
  const { status, message } = useConversationStatus();

  useEffect(() => {
    void fetchVoiceStatus()
      .then((statusPayload) => setEnabled(statusPayload.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    void fetchVoiceDisclosure(locale).then((payload) =>
      setDisclosure({ version: payload.version, text: payload.text }),
    );
  }, [i18n, locale]);

  const bindSession = useCallback(
    (id: string) => {
      sessionIdRef.current = id;
      setSessionId(id);
    },
    [sessionIdRef],
  );

  async function onAcknowledge() {
    setError(undefined);
    try {
      const started = await startVoiceSession({ locale, disclosureVersion: disclosure.version });
      await ackVoiceDisclosure(started.session.id, disclosure.version);
      bindSession(started.session.id);
      setTransport(started.transport);
      setLiveFallbackReason(started.liveFallbackReason);
      setConversationToken(started.conversationToken);
      setPhase("disclosed");
      await reportMockCallStatus(started.session.id, "ringing", crypto.randomUUID());
    } catch {
      setError(t("error.retry"));
    }
  }

  async function onStartCall() {
    if (!sessionId) {
      return;
    }
    setError(undefined);
    try {
      await reportMockCallStatus(sessionId, "in_progress", crypto.randomUUID());
      if (transport === "elevenlabs_webrtc" && conversationToken) {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          startSession({ conversationToken });
        } catch {
          setTransport("mock_browser");
          setError(t("voice.callFailed"));
        }
      }
      const safetyResult = await evaluateVoiceSafety(sessionId);
      setSafety(safetyResult.safety);
      setQuestion(safetyResult.nextQuestion ?? "");
      setPhase("live");
    } catch {
      setError(t("voice.callFailed"));
    }
  }

  async function onSubmitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !answer.trim()) {
      return;
    }
    try {
      const submitted = await submitVoiceAnswer(sessionId, answer.trim());
      const safetyResult = await evaluateVoiceSafety(sessionId);
      setSafety(safetyResult.safety);
      setQuestion(submitted.nextQuestion ?? safetyResult.nextQuestion ?? "");
      setAnswer("");
    } catch {
      setError(t("error.retry"));
    }
  }

  async function onShowSummary() {
    if (!sessionId) {
      return;
    }
    setError(undefined);
    try {
      if (status === "connected") {
        endSession();
      }
      await reportMockCallStatus(sessionId, "ended", crypto.randomUUID());
      const payload = await fetchVoiceSummary(sessionId);
      setSummary(payload.summary);
      setSafety(payload.safety);
      const symptoms = payload.session.symptoms ?? [];
      setSaveCandidates(symptoms);
      setSelectedFactIds(symptoms.map((item) => item.id));
      setPhase("summary");
    } catch {
      setError(t("error.retry"));
    }
  }

  async function onSms() {
    if (!sessionId || !phone.trim()) {
      return;
    }
    try {
      const result = await requestSummarySms(sessionId, phone.trim());
      setSmsNote(t(result.messageKey));
    } catch {
      setError(t("error.retry"));
    }
  }

  async function onCallback() {
    if (!sessionId) {
      return;
    }
    try {
      const result = await requestInterviewCallback(sessionId);
      setCallbackRequested(true);
      setCallbackNote(t(result.messageKey));
    } catch {
      setError(t("error.retry"));
    }
  }

  async function onCancelCallback() {
    if (!sessionId) {
      return;
    }
    try {
      const result = await cancelInterviewCallback(sessionId);
      setCallbackRequested(false);
      setCallbackNote(t(result.messageKey));
    } catch {
      setError(t("error.retry"));
    }
  }

  async function onHangUp() {
    if (status === "connected") {
      endSession();
    }
    if (sessionId) {
      try {
        await closeVoiceSession(sessionId);
      } catch {
        /* already closed */
      }
    }
    sessionIdRef.current = undefined;
    setPhase("idle");
    setSessionId(undefined);
    setLiveFallbackReason(undefined);
    setError(undefined);
    setSummary(undefined);
    setSafety(undefined);
    setCallbackNote(undefined);
    setSmsNote(undefined);
    setCallbackRequested(false);
    setSaveCandidates([]);
    setSelectedFactIds([]);
    setSaveNote(undefined);
  }

  async function onSaveRecord() {
    if (!sessionId) {
      return;
    }
    if (selectedFactIds.length === 0) {
      setSaveNote(t("records.needSelection"));
      return;
    }
    setSavingRecord(true);
    setError(undefined);
    try {
      const record = await ensureRecordForVoice();
      await persistFactsFromVoice(record.id, sessionId, selectedFactIds);
      await computeRecordScore(record.id);
      setSaveNote(t("records.saved"));
    } catch {
      setError(t("error.retry"));
    } finally {
      setSavingRecord(false);
    }
  }

  function toggleFact(id: string) {
    setSelectedFactIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  if (!enabled) {
    return (
      <main className="voice-page">
        <div className="voice-atmosphere" aria-hidden="true">
          <div className="voice-atmosphere-aurora" />
          <div className="voice-atmosphere-mesh" />
        </div>
        <Link className="voice-back" to="/">
          {t("voice.home")}
        </Link>
        <h1 className="voice-display">{t("voice.title")}</h1>
        <p className="voice-lede">{t("voice.disabled")}</p>
      </main>
    );
  }

  const liveTransport = transport === "elevenlabs_webrtc";
  const liveConnected = liveTransport && status === "connected";

  return (
    <main className={`voice-page is-${phase}`} onPointerMove={onStagePointer}>
      <div className="voice-atmosphere" aria-hidden="true">
        <div className="voice-atmosphere-aurora" />
        <div className="voice-atmosphere-mesh" />
        <div className="voice-atmosphere-scan" />
      </div>
      <p className="voice-watermark" aria-hidden="true">
        KKD
      </p>

      <header className="voice-hud">
        <Link className="voice-back" to="/">
          {t("voice.home")}
        </Link>
        <VoiceProgress phase={phase} />
        <div className="voice-lang" role="group" aria-label={t("voice.language")}>
          <button
            type="button"
            className={locale === "en" ? "is-on" : undefined}
            disabled={phase !== "idle"}
            onClick={() => setLocale("en")}
          >
            EN
          </button>
          <button
            type="button"
            className={locale === "sw" ? "is-on" : undefined}
            disabled={phase !== "idle"}
            onClick={() => setLocale("sw")}
          >
            SW
          </button>
        </div>
      </header>

      {phase === "idle" || phase === "disclosed" ? (
        <p className="voice-recording">{t("voice.recordingOff")}</p>
      ) : null}

      <div className="voice-alerts">
        {safety?.urgency === "emergency" ? (
          <p role="alert" className="voice-emergency">
            <span className="voice-emergency-dot" aria-hidden="true" />
            {t("urgency.emergency")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="voice-alert">
            {error}
          </p>
        ) : null}
        {status === "error" && message ? (
          <p role="alert" className="voice-alert">
            {message}
          </p>
        ) : null}
      </div>

      {phase === "idle" ? (
        <div className="voice-hero voice-phase">
          <div className="voice-hero-main">
            <div className="voice-hero-copy">
              <p className="voice-kicker">KKD</p>
              <h1 className="voice-display">{t("voice.title")}</h1>
            </div>
            <div className="voice-hero-object">
              <VoiceOrb mode="idle" />
            </div>
          </div>
          <section className="voice-hero-aside">
            <h2>{t("disclosure.title")}</h2>
            <p className="voice-copy">{disclosure.text}</p>
            <div className="voice-actions">
              <button className="voice-btn voice-btn-primary" type="button" onClick={() => void onAcknowledge()}>
                {t("disclosure.acknowledge")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {phase === "disclosed" ? (
        <section className="voice-stage voice-phase">
          <p className="voice-meta">
            <span>{t("voice.recordingOff")}</span>
            <span className={liveTransport ? "is-live" : undefined}>
              {liveTransport ? t("voice.transport.liveShort") : t("voice.transport.mockShort")}
            </span>
          </p>
          <button className="voice-orb-hit" type="button" onClick={() => void onStartCall()}>
            <VoiceOrb mode={orbMode({ live: liveTransport, mock: !liveTransport })} />
            <span className="voice-orb-cta">{t("voice.startCall")}</span>
          </button>
          <p className="voice-status-word">
            {liveTransport ? t("voice.status.startWhenReady") : t("voice.status.typeAnswer")}
          </p>
          <p className="voice-copy">
            {liveTransport ? t("voice.liveHandset") : t("voice.mockHandset")}
          </p>
          <TechnicalFallback reason={liveFallbackReason} />
        </section>
      ) : null}

      {phase === "live" ? (
        <>
          <section className="voice-live voice-phase">
            <p className="voice-meta">
              <span>{t("voice.recordingOff")}</span>
              <span className={liveConnected ? "is-live" : undefined}>
                {liveConnected ? t("voice.transport.liveShort") : t("voice.transport.mockShort")}
              </span>
            </p>
            <div className="voice-live-stage">
              <VoiceOrb
                mode={orbMode({ live: liveConnected, mock: !liveConnected, listening: liveConnected })}
              />
              <p className="voice-question" aria-live="polite" aria-atomic="true">
                {question}
              </p>
            </div>
            {liveFallbackReason && transport === "mock_browser" ? (
              <TechnicalFallback reason={liveFallbackReason} />
            ) : null}
            <p className="voice-hint">
              {liveConnected ? t("voice.status.listening") : t("voice.status.typeAnswer")}
              {liveConnected ? ` · ${t("voice.speakOrType")}` : ""}
            </p>
          </section>
          <form className="voice-dock" onSubmit={(event) => void onSubmitAnswer(event)}>
            <label className="voice-dock-line">
              <span>{t("voice.yourAnswer")}</span>
              <textarea rows={1} value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </label>
            <div className="voice-actions">
              <button className="voice-btn voice-btn-primary" type="submit">
                {t("voice.sendAnswer")}
              </button>
              <button className="voice-btn voice-btn-ghost" type="button" onClick={() => void onShowSummary()}>
                {t("voice.endAndSummary")}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {phase === "summary" && summary ? (
        <section className="voice-sheet voice-phase">
          <header className="voice-record-head">
            <p className="voice-kicker">{t("records.ehrTitle")}</p>
            <h1 className="voice-record-title">{summary.reasonForSeekingCare}</h1>
          </header>
          <div className="voice-record-body">
            <RecordBlock
              label={t("voice.record.chief")}
              items={uniqueLines(summary.symptomsReported, summary.reasonForSeekingCare)}
            />
            <RecordBlock label={t("voice.record.timeline")} text={summary.timeline} />
            <RecordBlock label={t("voice.record.intensity")} items={summary.severityAndMeasurements} />
            <RecordBlock label={t("voice.record.associated")} items={summary.associatedSymptoms} />
            <RecordBlock label={t("voice.record.denied")} items={summary.symptomsExplicitlyDenied} />
            <RecordBlock label={t("voice.record.medications")} items={summary.medicationAlreadyTaken} />
            <RecordBlock label={t("voice.record.context")} items={summary.relevantContext} />
            <RecordBlock
              label={t("voice.record.unknown")}
              items={summary.unknownOrUnanswered.map((item) => labelUnknownFact(item, t))}
            />
            <RecordBlock label={t("voice.record.plan")} text={summary.recommendedNextAction} />
          </div>
          <footer className="voice-record-footer">
            {saveCandidates.length > 0 ? (
              <fieldset className="fact-select">
                <legend>{t("records.selectFacts")}</legend>
                {saveCandidates.map((item) => (
                  <label key={item.id} className="fact-select-item">
                    <input
                      type="checkbox"
                      checked={selectedFactIds.includes(item.id)}
                      onChange={() => toggleFact(item.id)}
                    />
                    <span>{item.patientWording ?? item.concept}</span>
                  </label>
                ))}
                <div className="voice-actions">
                  <button
                    className="voice-btn voice-btn-primary"
                    type="button"
                    disabled={savingRecord}
                    onClick={() => void onSaveRecord()}
                  >
                    {savingRecord ? t("records.saving") : t("consent.saveRecord")}
                  </button>
                  {saveNote ? (
                    <Link className="voice-btn voice-btn-ghost" to="/profile/history">
                      {t("records.viewHistory")}
                    </Link>
                  ) : null}
                </div>
                {saveNote ? <p className="voice-hint">{saveNote}</p> : null}
              </fieldset>
            ) : null}
            <div className="voice-actions">
              <Link className="voice-btn voice-btn-accent" to="/care-near-me">
                {t("voice.sendToHospital")}
              </Link>
            </div>
            <p className="voice-hint">{t("voice.locationHint")}</p>
            <label>
              {t("voice.smsPhone")}
              <input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <div className="voice-actions voice-actions-secondary">
              <button className="voice-btn voice-btn-ghost" type="button" onClick={() => void onSms()}>
                {t("voice.sendSms")}
              </button>
              {sessionId ? (
                <button className="voice-btn voice-btn-ghost" type="button" onClick={() => void onCallback()}>
                  {t("voice.continueLater")}
                </button>
              ) : null}
              {callbackRequested ? (
                <button className="voice-btn voice-btn-ghost" type="button" onClick={() => void onCancelCallback()}>
                  {t("voice.cancelCallback")}
                </button>
              ) : null}
              <button className="voice-btn voice-btn-ghost" type="button" onClick={() => void onHangUp()}>
                {t("voice.done")}
              </button>
            </div>
            {smsNote ? <p className="voice-hint">{smsNote}</p> : null}
            {callbackNote ? <p className="voice-hint">{callbackNote}</p> : null}
          </footer>
        </section>
      ) : null}
    </main>
  );
}

export function VoiceCall() {
  const sessionIdRef = useRef<string | undefined>(undefined);

  return (
    <ConversationProvider
      clientTools={{
        submit_patient_answer: async (parameters: { text?: string }) => {
          const id = sessionIdRef.current;
          if (!id || !parameters.text) {
            return "missing_parameters";
          }
          const result = await submitVoiceAnswer(id, parameters.text);
          return result.nextQuestion ?? "ok";
        },
        get_next_question: async () => {
          const id = sessionIdRef.current;
          if (!id) {
            return "missing_session";
          }
          const result = await fetchNextQuestion(id);
          return result.nextQuestion ?? "ok";
        },
        evaluate_safety: async () => {
          const id = sessionIdRef.current;
          if (!id) {
            return "missing_session";
          }
          const result = await evaluateVoiceSafety(id);
          return result.safety.urgency;
        },
        get_factual_summary: async () => {
          const id = sessionIdRef.current;
          if (!id) {
            return "missing_session";
          }
          const result = await fetchVoiceSummary(id);
          return result.summary?.recommendedNextAction ?? "ok";
        },
        close_session: async () => {
          const id = sessionIdRef.current;
          if (!id) {
            return "missing_session";
          }
          await closeVoiceSession(id);
          return "closed";
        },
      }}
    >
      <VoiceCallInner sessionIdRef={sessionIdRef} />
    </ConversationProvider>
  );
}
