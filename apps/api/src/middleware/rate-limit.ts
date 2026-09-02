import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Channel callbacks (spec §11.5).
 *
 * Headroom is higher than the browser limiter because a single aggregator or
 * gateway fans in every concurrent caller from one address, and throttling it
 * would drop other people's safety messages. The gateway is authenticated by
 * HMAC, so this is a blast-radius cap rather than the access control.
 */
export const channelRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // The response must stay in the provider's expected format, so no JSON body.
  message: "",
});
