import { ConversationProvider, useConversationControls, useConversationStatus } from "@elevenlabs/react";
import type { ConsultationSummary, SafetyAssessment } from "@kkd/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
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

function VoiceCallInner({ sessionIdRef }: { sessionIdRef: { current?: string } }) {
  const { t, i18n } = useTranslation();
  const [locale, setLocale] = useState(i18n.language.startsWith("sw") ? "sw" : "en");
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [disclosure, setDisclosure] = useState({ version: "", text: "" });
  const [sessionId, setSessionId] = useState<string>();
  const [transport, setTransport] = useState<"elevenlabs_webrtc" | "mock_browser">("mock_browser");
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
    try {
      if (status === "connected") {
        endSession();
      }
      await reportMockCallStatus(sessionId, "ended", crypto.randomUUID());
      const payload = await fetchVoiceSummary(sessionId);
      setSummary(payload.summary);
      setSafety(payload.safety);
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
    setSummary(undefined);
    setSafety(undefined);
    setCallbackNote(undefined);
    setSmsNote(undefined);
    setCallbackRequested(false);
  }

  if (!enabled) {
    return (
      <main>
        <h1>{t("voice.title")}</h1>
        <p>{t("voice.disabled")}</p>
      </main>
    );
  }

  return (
    <main>
      <p>
        <Link to="/">{t("voice.home")}</Link>
      </p>
      <h1>{t("voice.title")}</h1>
      <p>{t("voice.subtitle")}</p>
      <label>
        {t("voice.language")}
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
          disabled={phase !== "idle"}
        >
          <option value="en">English</option>
          <option value="sw">Kiswahili</option>
        </select>
      </label>

      {safety?.urgency === "emergency" ? (
        <p role="alert" className="voice-emergency">
          {t("urgency.emergency")}
        </p>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      {status === "error" && message ? <p role="alert">{message}</p> : null}

      {phase === "idle" ? (
        <section>
          <h2>{t("disclosure.title")}</h2>
          <p>{disclosure.text}</p>
          <button type="button" onClick={() => void onAcknowledge()}>
            {t("disclosure.acknowledge")}
          </button>
        </section>
      ) : null}

      {phase === "disclosed" ? (
        <section className="voice-handset">
          <p>{t("voice.mockHandset")}</p>
          <p>{t("voice.recordingOff")}</p>
          <button type="button" onClick={() => void onStartCall()}>
            {t("voice.startCall")}
          </button>
        </section>
      ) : null}

      {phase === "live" ? (
        <section className="voice-handset">
          <p>
            {t("voice.callStatus")}:{" "}
            {transport === "elevenlabs_webrtc" ? t("voice.transport.live") : t("voice.transport.mock")}
            {transport === "elevenlabs_webrtc" ? ` (${status})` : null}
          </p>
          <p>{t("voice.recordingOff")}</p>
          <p>{question}</p>
          <form onSubmit={(event) => void onSubmitAnswer(event)}>
            <label>
              {t("voice.yourAnswer")}
              <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </label>
            <button type="submit">{t("voice.sendAnswer")}</button>
          </form>
          <button type="button" onClick={() => void onShowSummary()}>
            {t("voice.endAndSummary")}
          </button>
        </section>
      ) : null}

      {phase === "summary" && summary ? (
        <section>
          <h2>{t("voice.summaryTitle")}</h2>
          <p>{summary.reasonForSeekingCare}</p>
          <ul>
            {summary.symptomsReported.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{summary.recommendedNextAction}</p>
          <p>
            <Link to="/care-near-me">{t("voice.sendToHospital")}</Link>
          </p>
          <p>{t("voice.locationHint")}</p>
          <label>
            {t("voice.smsPhone")}
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <button type="button" onClick={() => void onSms()}>
            {t("voice.sendSms")}
          </button>
          {smsNote ? <p>{smsNote}</p> : null}
          {sessionId ? (
            <>
              <button type="button" onClick={() => void onCallback()}>
                {t("voice.continueLater")}
              </button>
              {callbackRequested ? (
                <button type="button" onClick={() => void onCancelCallback()}>
                  {t("voice.cancelCallback")}
                </button>
              ) : null}
            </>
          ) : null}
          {callbackNote ? <p>{callbackNote}</p> : null}
          <button type="button" onClick={() => void onHangUp()}>
            {t("voice.done")}
          </button>
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
