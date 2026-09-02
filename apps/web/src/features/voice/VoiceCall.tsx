import { ConversationProvider, useConversationControls, useConversationStatus } from "@elevenlabs/react";
import type { ConsultationSummary, ReportedSymptom, SafetyAssessment } from "@kkd/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { computeRecordScore, ensureRecordForVoice, persistFactsFromVoice } from "../records";
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

function VoiceSteps({ phase }: { phase: CallPhase }) {
  const { t } = useTranslation();
  const current = stepIndex(phase);
  const labels = [t("voice.step.ready"), t("voice.step.live"), t("voice.step.summary")];

  return (
    <ol className="voice-steps" aria-label={t("voice.stepsLabel")}>
      {labels.map((label, index) => (
        <li
          key={label}
          className={index === current ? "is-current" : index < current ? "is-done" : undefined}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="voice-steps-index">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function VoiceStatus({
  word,
  pulsing,
}: {
  word: string;
  pulsing: boolean;
}) {
  return (
    <div className="voice-status">
      <span className={pulsing ? "voice-status-dot is-live" : "voice-status-dot"} aria-hidden="true" />
      <p className="voice-status-word">{word}</p>
    </div>
  );
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
        <p className="voice-kicker">
          <Link className="voice-back" to="/">
            {t("voice.home")}
          </Link>
        </p>
        <h1>{t("voice.title")}</h1>
        <p className="voice-lede">{t("voice.disabled")}</p>
      </main>
    );
  }

  const liveTransport = transport === "elevenlabs_webrtc";

  return (
    <main className={phase === "idle" || phase === "summary" ? "voice-page" : "voice-page is-focused"}>
      <header className="voice-top">
        <Link className="voice-back" to="/">
          {t("voice.home")}
        </Link>
        <label className="voice-locale">
          <span>{t("voice.language")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            disabled={phase !== "idle"}
          >
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </label>
      </header>

      <h1>{t("voice.title")}</h1>
      <p className="voice-lede">{t("voice.subtitle")}</p>
      <VoiceSteps phase={phase} />

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

      {phase === "idle" ? (
        <section className="voice-card voice-phase">
          <h2>{t("disclosure.title")}</h2>
          <p className="voice-copy">{disclosure.text}</p>
          <div className="voice-actions">
            <button className="voice-btn voice-btn-primary" type="button" onClick={() => void onAcknowledge()}>
              {t("disclosure.acknowledge")}
            </button>
          </div>
        </section>
      ) : null}

      {phase === "disclosed" ? (
        <section className="voice-handset voice-phase">
          <VoiceStatus
            word={liveTransport ? t("voice.status.startWhenReady") : t("voice.status.typeAnswer")}
            pulsing={false}
          />
          <div className="voice-chips">
            <span className="voice-chip">{t("voice.recordingOff")}</span>
            <span className={liveTransport ? "voice-chip is-live" : "voice-chip"}>
              {liveTransport ? t("voice.transport.liveShort") : t("voice.transport.mockShort")}
            </span>
          </div>
          <p className="voice-copy">
            {liveTransport ? t("voice.liveHandset") : t("voice.mockHandset")}
          </p>
          <TechnicalFallback reason={liveFallbackReason} />
          <div className="voice-actions">
            <button className="voice-btn voice-btn-primary voice-btn-start" type="button" onClick={() => void onStartCall()}>
              {t("voice.startCall")}
            </button>
          </div>
        </section>
      ) : null}

      {phase === "live" ? (
        <section className="voice-handset voice-phase">
          <VoiceStatus
            word={
              liveTransport && status === "connected"
                ? t("voice.status.listening")
                : t("voice.status.typeAnswer")
            }
            pulsing={liveTransport && status === "connected"}
          />
          <div className="voice-chips">
            <span className="voice-chip">{t("voice.recordingOff")}</span>
            <span className={liveTransport && status === "connected" ? "voice-chip is-live" : "voice-chip"}>
              {liveTransport && status === "connected"
                ? t("voice.transport.liveShort")
                : t("voice.transport.mockShort")}
            </span>
          </div>
          {liveFallbackReason && transport === "mock_browser" ? (
            <TechnicalFallback reason={liveFallbackReason} />
          ) : null}
          <p className="voice-question" aria-live="polite" aria-atomic="true">
            {question}
          </p>
          {liveTransport && status === "connected" ? <p className="voice-hint">{t("voice.speakOrType")}</p> : null}
          <form className="voice-answer" onSubmit={(event) => void onSubmitAnswer(event)}>
            <label>
              {t("voice.yourAnswer")}
              <textarea rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} />
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
        </section>
      ) : null}

      {phase === "summary" && summary ? (
        <section className="voice-card voice-phase">
          <p className="voice-kicker">{t("voice.summaryTitle")}</p>
          <h2>{summary.reasonForSeekingCare}</h2>
          <ul className="voice-facts">
            {summary.symptomsReported.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="voice-copy">{summary.recommendedNextAction}</p>
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
