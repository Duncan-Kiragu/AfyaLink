import {
  outboundChannelMessageSchema,
  type DeliveryStatusEvent,
  type NormalizedInboundMessage,
  type OutboundChannelMessage,
} from "@kkd/contracts";
import {
  CHANNEL_SIGNATURE_HEADER,
  CHANNEL_TIMESTAMP_HEADER,
  signChannelPayload,
} from "@kkd/integrations/channel";
import { z } from "zod";

/**
 * Signed client for the gateway -> API hop.
 *
 * The gateway holds no clinical logic: it posts a normalized message and gets
 * the replies to send back. That keeps the conversation engine in one place and
 * lets this process be restarted or re-paired without touching session state.
 */

const inboundResponseSchema = z.object({
  messages: z.array(outboundChannelMessageSchema),
  replayed: z.boolean().optional(),
});

export class KkdApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`KKD API responded ${status} ${code}`);
    this.name = "KkdApiError";
  }
}

export interface KkdApiClientOptions {
  baseUrl: string;
  secret: string;
  timeoutMs?: number;
}

export class KkdApiClient {
  constructor(private readonly options: KkdApiClientOptions) {}

  async submitInbound(message: NormalizedInboundMessage): Promise<OutboundChannelMessage[]> {
    const parsed = inboundResponseSchema.parse(
      await this.post("/api/v1/integrations/whatsapp/inbound", { message }),
    );
    return parsed.messages;
  }

  async reportDeliveryStatus(event: DeliveryStatusEvent): Promise<void> {
    await this.post("/api/v1/integrations/whatsapp/status", event);
  }

  /** Drains proactive sends (scheduled check-ins) queued by the worker. */
  async drainOutbox(): Promise<OutboundChannelMessage[]> {
    const parsed = inboundResponseSchema.parse(
      await this.get("/api/v1/integrations/whatsapp/outbox"),
    );
    return parsed.messages;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const raw = JSON.stringify(body);
    return this.request(path, "POST", raw);
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path, "GET", "");
  }

  private async request(path: string, method: "GET" | "POST", raw: string): Promise<unknown> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      const response = await fetch(new URL(path, this.options.baseUrl), {
        method,
        headers: {
          "content-type": "application/json",
          [CHANNEL_TIMESTAMP_HEADER]: timestamp,
          [CHANNEL_SIGNATURE_HEADER]: signChannelPayload(this.options.secret, timestamp, raw),
        },
        ...(method === "POST" ? { body: raw } : {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new KkdApiError(response.status, detail.error ?? "unknown");
      }
      if (response.status === 204) return {};
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
