import {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  makeWASocket,
  type AuthenticationState,
  type WAMessage,
  type WASocket,
} from "baileys";
import type {
  ConversationChannelAdapter,
  DeliveryResult,
  DeliveryStatus,
  DeliveryStatusEvent,
  NormalizedInboundMessage,
  OutboundChannelMessage,
  VerifiedInboundEvent,
} from "@kkd/contracts";
import type { ChannelIdentityHasher } from "../channel/identity.js";
import { renderOutboundBody } from "../channel/choices.js";
import { extractWhatsAppText, shouldProcessWhatsAppMessage } from "./normalize.js";

/**
 * WhatsApp channel adapter built on Baileys (https://baileys.wiki).
 *
 * Baileys speaks the WhatsApp Web multi-device protocol over a WebSocket, so
 * unlike the Meta Cloud API there is no inbound HTTP webhook to verify. The
 * adapter therefore owns the socket lifecycle, and the spec's webhook-oriented
 * reliability requirements (§11.5) are met as follows:
 *
 *  - signature verification -> the Noise handshake authenticates the transport;
 *    the gateway -> API hop is HMAC-signed (see `channel/signature.ts`).
 *  - replay protection     -> `message.key.id` is the idempotency key.
 *  - no raw payloads in logs -> the Baileys logger is a redacting child logger
 *    and this adapter only ever logs counts, ids, and statuses.
 *
 * Interactive buttons/lists are intentionally not used: they are a Business
 * Cloud API capability and are unreliable over the web protocol. Choices are
 * rendered as a deterministic numbered menu instead (see `channel/choices.ts`).
 */

export interface BaileysLogger {
  level: string;
  child(bindings: Record<string, unknown>): BaileysLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export type WhatsAppConnectionStatus = "idle" | "connecting" | "awaiting_pairing" | "open" | "closed";

export interface BaileysAdapterOptions {
  auth: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Wipes stored credentials after a `loggedOut` disconnect. */
  clearAuth: () => Promise<void>;
  hasher: ChannelIdentityHasher;
  logger: BaileysLogger;
  /** Called for each inbound message that survived normalization. */
  onInbound: (message: NormalizedInboundMessage) => Promise<void>;
  onDeliveryStatus?: (event: DeliveryStatusEvent) => Promise<void>;
  /** Surfaced for operator pairing; the QR itself is not a secret to the user. */
  onPairingCode?: (qr: string) => void;
  onStatusChange?: (status: WhatsAppConnectionStatus) => void;
  /** Baileys reconnect backoff bounds. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  browserName?: string;
}

const DELIVERY_STATUS_BY_CODE: Record<number, DeliveryStatus> = {
  0: "pending",
  1: "sent",
  2: "sent",
  3: "delivered",
  4: "read",
  5: "read",
};

export class WhatsAppNotConnectedError extends Error {
  constructor() {
    super("WhatsApp socket is not connected");
    this.name = "WhatsAppNotConnectedError";
  }
}

export class BaileysWhatsAppAdapter implements ConversationChannelAdapter {
  private socket: WASocket | undefined;
  private status: WhatsAppConnectionStatus = "idle";
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  /** JID keyed by pseudonym, so outbound sends never need a phone number. */
  private readonly jidByHash = new Map<string, string>();

  constructor(private readonly options: BaileysAdapterOptions) {}

  getStatus(): WhatsAppConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === "open";
  }

  /** Lets the gateway prime a reply target for a session resumed after restart. */
  rememberIdentity(channelUserHash: string, jid: string): void {
    this.jidByHash.set(channelUserHash, jidNormalizedUser(jid));
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.setStatus("connecting");

    const socket = makeWASocket({
      auth: this.options.auth,
      logger: this.options.logger,
      browser: Browsers.ubuntu(this.options.browserName ?? "KKD"),
      // KKD only reacts to live messages. Pulling chat history would import
      // unrelated personal conversations into a health service's memory.
      syncFullHistory: false,
      // Staying "online" suppresses the operator phone's own notifications.
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });

    this.socket = socket;

    socket.ev.on("creds.update", () => {
      void this.options.saveCreds().catch((error: unknown) => {
        this.options.logger.error(
          { event: "whatsapp_creds_save_failed", reason: errorName(error) },
          "failed to persist WhatsApp credentials",
        );
      });
    });

    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(update);
    });

    socket.ev.on("messages.upsert", (event) => {
      if (event.type !== "notify") return;
      void this.handleInboundBatch(event.messages);
    });

    socket.ev.on("messages.update", (updates) => {
      if (!this.options.onDeliveryStatus) return;
      void this.handleDeliveryUpdates(updates);
    });
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.jidByHash.clear();
    this.setStatus("closed");
    if (socket) {
      try {
        socket.end(undefined);
      } catch {
        // Socket already torn down; nothing to report.
      }
    }
  }

  /**
   * Baileys has no HTTP request to verify — the Noise handshake already
   * authenticated the transport. This exists so the adapter satisfies
   * `ConversationChannelAdapter` and so the gateway can normalize a raw
   * Baileys message through the same contract the other channels use.
   */
  async verifyInbound(request: unknown): Promise<VerifiedInboundEvent> {
    const message = request as WAMessage;
    const jid = message?.key?.remoteJid;
    const providerMessageId = message?.key?.id;
    if (!jid || !providerMessageId) {
      throw new Error("inbound WhatsApp message is missing key.remoteJid or key.id");
    }
    const channelUserHash = this.options.hasher.hashIdentity("whatsapp", jid);
    this.jidByHash.set(channelUserHash, jidNormalizedUser(jid));
    return {
      provider: "baileys",
      channel: "whatsapp",
      providerMessageId,
      channelUserHash,
      providerTimestamp: toEpochMillis(message.messageTimestamp),
      payload: message,
    };
  }

  async normalizeInbound(event: VerifiedInboundEvent): Promise<NormalizedInboundMessage> {
    const message = event.payload as WAMessage;
    const { text, rejection } = extractWhatsAppText(message);
    return {
      channel: "whatsapp",
      provider: "baileys",
      channelUserHash: event.channelUserHash,
      providerMessageId: event.providerMessageId,
      ...(text === undefined ? {} : { text }),
      ...(rejection === undefined ? {} : { rejection }),
    };
  }

  async send(message: OutboundChannelMessage): Promise<DeliveryResult> {
    const socket = this.socket;
    const jid = this.jidByHash.get(message.channelUserHash);
    if (!socket || this.status !== "open") {
      return { accepted: false, failureReason: "socket_not_connected" };
    }
    if (!jid) {
      return { accepted: false, failureReason: "unknown_recipient" };
    }
    try {
      const sent = await socket.sendMessage(jid, { text: renderOutboundBody(message) });
      return { accepted: true, ...(sent?.key?.id ? { providerMessageId: sent.key.id } : {}) };
    } catch (error) {
      this.options.logger.warn(
        { event: "whatsapp_send_failed", reason: errorName(error), urgent: message.urgent },
        "WhatsApp send failed",
      );
      return { accepted: false, failureReason: "provider_error" };
    }
  }

  private async handleInboundBatch(messages: WAMessage[]): Promise<void> {
    for (const message of messages) {
      if (!shouldProcessWhatsAppMessage(message)) continue;
      try {
        const verified = await this.verifyInbound(message);
        const normalized = await this.normalizeInbound(verified);
        await this.options.onInbound(normalized);
      } catch (error) {
        // Never log the message itself, only why it could not be handled.
        this.options.logger.warn(
          { event: "whatsapp_inbound_failed", reason: errorName(error) },
          "dropping unprocessable WhatsApp message",
        );
      }
    }
  }

  private async handleDeliveryUpdates(
    updates: { key: { id?: string | null }; update: { status?: number | null } }[],
  ): Promise<void> {
    const notify = this.options.onDeliveryStatus;
    if (!notify) return;
    for (const { key, update } of updates) {
      const code = update?.status;
      if (!key?.id || code === null || code === undefined) continue;
      const status = DELIVERY_STATUS_BY_CODE[code];
      if (!status) continue;
      try {
        await notify({
          channel: "whatsapp",
          provider: "baileys",
          providerMessageId: key.id,
          status,
          at: new Date().toISOString(),
        });
      } catch (error) {
        this.options.logger.warn(
          { event: "whatsapp_delivery_status_failed", reason: errorName(error) },
          "failed to record WhatsApp delivery status",
        );
      }
    }
  }

  private async handleConnectionUpdate(update: {
    connection?: string;
    qr?: string;
    lastDisconnect?: { error?: unknown } | undefined;
  }): Promise<void> {
    if (update.qr) {
      this.setStatus("awaiting_pairing");
      this.options.onPairingCode?.(update.qr);
    }

    if (update.connection === "open") {
      this.reconnectAttempts = 0;
      this.setStatus("open");
      this.options.logger.info({ event: "whatsapp_connected" }, "WhatsApp socket open");
      return;
    }

    if (update.connection !== "close") return;

    const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
    this.socket = undefined;
    this.setStatus("closed");

    if (statusCode === DisconnectReason.loggedOut) {
      // The operator number was unlinked. Keeping stale credentials would loop
      // forever on a 401, so clear them and wait for a fresh pairing.
      this.options.logger.error(
        { event: "whatsapp_logged_out" },
        "WhatsApp session logged out; clearing stored credentials",
      );
      await this.options.clearAuth().catch(() => undefined);
      return;
    }

    if (this.stopped) return;
    this.scheduleReconnect(statusCode);
  }

  private scheduleReconnect(statusCode: number | undefined): void {
    const base = this.options.reconnectBaseMs ?? 2_000;
    const max = this.options.reconnectMaxMs ?? 60_000;
    this.reconnectAttempts += 1;
    const backoff = Math.min(max, base * 2 ** (this.reconnectAttempts - 1));
    // Full jitter, so a fleet restart does not stampede WhatsApp's edge.
    const delay = Math.round(backoff * (0.5 + Math.random() * 0.5));
    this.options.logger.warn(
      {
        event: "whatsapp_reconnect_scheduled",
        attempt: this.reconnectAttempts,
        delayMs: delay,
        statusCode,
      },
      "reconnecting to WhatsApp",
    );
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error: unknown) => {
        this.options.logger.error(
          { event: "whatsapp_reconnect_failed", reason: errorName(error) },
          "WhatsApp reconnect failed",
        );
        if (!this.stopped) this.scheduleReconnect(statusCode);
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private setStatus(status: WhatsAppConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}

function disconnectStatusCode(error: unknown): number | undefined {
  const output = (error as { output?: { statusCode?: number } } | undefined)?.output;
  return typeof output?.statusCode === "number" ? output.statusCode : undefined;
}

/** Error class/name only — messages can quote patient content. */
function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

function toEpochMillis(timestamp: WAMessage["messageTimestamp"]): number | undefined {
  if (timestamp === null || timestamp === undefined) return undefined;
  const seconds = typeof timestamp === "number" ? timestamp : Number(timestamp);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
