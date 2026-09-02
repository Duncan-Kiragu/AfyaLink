import type { Redis } from "ioredis";
import {
  channelRedisKeys,
  type ConversationEngine,
  type OutboundChannelMessage,
} from "@kkd/contracts";
import type { ChannelIdentityHasher } from "@kkd/integrations/channel";
import { resolveLocale, t } from "@kkd/i18n";
import { createLogger } from "@kkd/observability";
import type { UssdSummaryDelivery } from "@kkd/integrations/ussd";
import type { ChannelSessionStore } from "./channel-session.js";

/**
 * Optional delivery of the factual summary to another channel (spec §11.4B).
 *
 * A USSD screen cannot carry a handover summary, so the caller may ask for it
 * on WhatsApp instead.
 *
 * The identity hash is namespaced per channel, so a USSD pseudonym cannot be
 * turned into a WhatsApp pseudonym at rest. The WhatsApp hash is derived here
 * from the phone number the aggregator supplied for this one request and is
 * never stored — the cross-channel link exists only for the duration of the
 * call, and only because the caller asked for it.
 *
 * The offer is only made when delivery is actually possible: the recipient must
 * already have an active WhatsApp session, because the transport can only
 * address a pseudonym it has seen write in. Offering otherwise would be
 * promising something we cannot do (spec §20 — never claim a delivery that did
 * not happen).
 */

const log = createLogger("api.channels.summary-delivery");

export interface SummaryDeliveryDeps {
  redis: Redis;
  engine: ConversationEngine;
  channelSessions: ChannelSessionStore;
  hasher: ChannelIdentityHasher;
  /** Raw phone number for this request only. Never persisted. */
  phoneNumber: string;
}

export function createUssdSummaryDelivery(deps: SummaryDeliveryDeps): UssdSummaryDelivery {
  const whatsappHash = () => deps.hasher.hashIdentity("whatsapp", deps.phoneNumber);

  return {
    async offerAvailable() {
      const lookup = await deps.channelSessions.find("whatsapp", whatsappHash());
      return Boolean(lookup.session);
    },

    async deliver(state) {
      const lookup = await deps.channelSessions.find("whatsapp", whatsappHash());
      if (!lookup.session) return false;

      const turn = await deps.engine.getSummary(state.sessionId).catch(() => undefined);
      if (!turn?.summary) {
        log.warn(
          { event: "ussd_summary_unavailable", channel: "ussd", language: state.locale },
          "summary could not be produced for cross-channel delivery",
        );
        return false;
      }

      const locale = resolveLocale(state.locale);
      const message: OutboundChannelMessage = {
        channel: "whatsapp",
        channelUserHash: lookup.session.channelUserHash,
        text: [
          t(locale, "channel.summary.ready"),
          "",
          turn.summary.reasonForSeekingCare,
          ...turn.summary.symptomsReported.map((line) => `• ${line}`),
          "",
          turn.summary.recommendedNextAction,
        ].join("\n"),
        choices: [],
        choiceLabels: {},
        locale,
        urgent: false,
        terminal: false,
      };

      await deps.redis.rpush(channelRedisKeys.whatsappOutbox(), JSON.stringify(message));
      log.info(
        { event: "ussd_summary_queued", channel: "whatsapp", language: locale },
        "queued factual summary for WhatsApp delivery",
      );
      return true;
    },
  };
}
