import type { AiDisclosure, Channel } from "@kkd/contracts";
import { t, resolveLocale } from "@kkd/i18n";

/**
 * Versioned, channel-specific AI disclosure (spec §4.3J, §15).
 *
 * The text lives in reviewed locale files, never in model output. Bumping the
 * version invalidates every acknowledgement, so an in-flight channel session
 * is re-disclosed rather than silently carried over.
 */
export const CURRENT_DISCLOSURE_VERSION = "1.0.0";

const CHANNEL_MESSAGE_KEY: Record<Channel, string> = {
  web: "disclosure.body",
  whatsapp: "channel.disclosure.whatsapp",
  ussd: "channel.disclosure.ussd",
  voice: "disclosure.body",
  mcp: "disclosure.body",
};

export function getDisclosure(channel: Channel, locale: string): AiDisclosure {
  const resolved = resolveLocale(locale);
  return {
    id: `kkd.disclosure.${channel}`,
    version: CURRENT_DISCLOSURE_VERSION,
    locale: resolved,
    channel,
    text: t(resolved, CHANNEL_MESSAGE_KEY[channel]),
    // Every channel requires an affirmative acknowledgement before the first
    // clinical message. There is no silent-consent channel.
    requiresAcknowledgement: true,
  };
}

export function isDisclosureCurrent(version: string | undefined): boolean {
  return version === CURRENT_DISCLOSURE_VERSION;
}
