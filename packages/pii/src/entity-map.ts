import type { AnalyzerEntity } from "./types.js";

const ADDRESS_HINTS =
  /\b(?:road|street|avenue|estate|close|lane|drive|plot|house|p\.?\s*o\.?\s*box|namba|barabara)\b/i;

export function mapPresidioEntity(
  entityType: string,
  text: string,
  start: number,
  end: number,
): AnalyzerEntity | undefined {
  const slice = text.slice(start, end);
  switch (entityType) {
    case "PERSON":
      return { type: "person_name", start, end };
    case "PHONE_NUMBER":
    case "KE_PHONE_NUMBER":
      return { type: "phone", start, end };
    case "EMAIL_ADDRESS":
      return { type: "email", start, end };
    case "LOCATION":
      if (
        !ADDRESS_HINTS.test(slice) &&
        !ADDRESS_HINTS.test(text.slice(Math.max(0, start - 24), end + 24))
      ) {
        return undefined;
      }
      return { type: "address", start, end };
    case "DATE_TIME": {
      const window = text.slice(Math.max(0, start - 40), end + 12);
      if (!/(?:dob|date of birth|born|kuzaliwa|birthday)/i.test(window)) {
        return undefined;
      }
      return { type: "date_of_birth", start, end };
    }
    case "KE_NATIONAL_ID":
    case "US_SSN":
    case "ID":
      return { type: "national_id", start, end };
    case "KE_ORG_ID":
      return { type: "org_identifier", start, end };
    case "CREDIT_CARD":
    case "IBAN_CODE":
    case "CRYPTO":
      return { type: "account_reference", start, end };
    default:
      return undefined;
  }
}
