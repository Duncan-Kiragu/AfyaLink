import {
  CHECK_IN_CONSENT_DISCLOSURE,
  PROFILE_CONSENT_VERSION,
  V1_DELIVERABLE_CHECK_IN_CHANNELS,
  type Channel,
  type CheckInConsentDisclosure,
  type FollowUpCadence,
} from "@kkd/contracts";

/**
 * Consent rules for scheduled check-ins (spec §8.4.A), as pure predicates.
 *
 * Deliberately storage-free: §21.1 names consent rules as a unit-test surface, and the
 * §8.6 criterion "consent withdrawal stops future check-ins" is a property of these
 * functions, not of a database. The API layer supplies the stored consent state.
 */

/** The consent state these rules read. A projection of a `consents` row. */
export interface CheckInConsentState {
  readonly version: string;
  readonly channel?: Channel;
  readonly grantedAt?: string;
  readonly withdrawnAt?: string;
}

export type CheckInConsentRefusal =
  /** Nothing was ever granted. */
  | "not_granted"
  /** Granted, then withdrawn. §8.4.A "allow withdrawal". */
  | "withdrawn"
  /**
   * Granted against an older disclosure. A patient consented to what *that* version
   * said would be stored and how often they would be contacted; a newer disclosure is
   * a different promise and needs a fresh grant (spec §8.7, "profile data exists only
   * after explicit consent").
   */
  | "version_superseded";

export type CheckInConsentDecision =
  | { readonly allowed: true; readonly channel: Channel }
  | { readonly allowed: false; readonly reason: CheckInConsentRefusal };

/**
 * Whether check-ins may be scheduled, delivered or accepted right now.
 *
 * The single gate. Schedule creation, the due list, and answer intake all call it, so
 * withdrawal cannot stop one path and leave another open.
 */
export function checkInConsentDecision(
  consent: CheckInConsentState | undefined,
): CheckInConsentDecision {
  if (!consent || !consent.grantedAt) {
    return { allowed: false, reason: "not_granted" };
  }
  if (consent.withdrawnAt) {
    return { allowed: false, reason: "withdrawn" };
  }
  if (consent.version !== PROFILE_CONSENT_VERSION) {
    return { allowed: false, reason: "version_superseded" };
  }
  return { allowed: true, channel: consent.channel ?? "web" };
}

export function isCheckInConsentActive(consent: CheckInConsentState | undefined): boolean {
  return checkInConsentDecision(consent).allowed;
}

/** The disclosure a patient must be shown before the first persistent check-in. */
export function currentCheckInDisclosure(): CheckInConsentDisclosure {
  return CHECK_IN_CONSENT_DISCLOSURE;
}

/**
 * Whether a channel can actually deliver a check-in (`ws4-plan.md` §5 issue H).
 *
 * §8.4.A requires channel *selection*, which presumes the selection means something.
 * Accepting `whatsapp` today would record a preference nothing honours and leave a
 * patient believing they will be contacted, so unusable channels are refused at the
 * boundary rather than stored and ignored.
 */
export function isDeliverableCheckInChannel(channel: Channel): boolean {
  return (V1_DELIVERABLE_CHECK_IN_CHANNELS as readonly string[]).includes(channel);
}

/** Contacts per week a cadence implies, for the §8.4.A frequency ceiling. */
export function contactsPerWeek(cadence: FollowUpCadence): number {
  switch (cadence.kind) {
    case "daily":
      return 7;
    case "weekly":
      return 1;
    case "custom_interval":
      return 7 / cadence.intervalDays;
    case "custom_once":
      return 1;
  }
}

/**
 * Whether a cadence stays within the contact frequency the patient was shown.
 *
 * §8.4.A requires KKD to show how often it will make contact. A schedule more frequent
 * than the shown ceiling would make that disclosure false, so it is refused rather than
 * accepted and throttled later.
 */
export function isWithinDisclosedFrequency(
  cadence: FollowUpCadence,
  disclosure: CheckInConsentDisclosure = CHECK_IN_CONSENT_DISCLOSURE,
): boolean {
  return contactsPerWeek(cadence) <= disclosure.maxContactsPerWeek;
}
