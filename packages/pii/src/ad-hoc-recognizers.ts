export interface AdHocRecognizer {
  name: string;
  supported_language: string;
  supported_entity: string;
  patterns?: Array<{ name: string; regex: string; score: number }>;
  deny_list?: string[];
  context?: string[];
}

export function kenyanAdHocRecognizers(
  organizationIdentifiers: string[] = [],
): AdHocRecognizer[] {
  const recognizers: AdHocRecognizer[] = [
    {
      name: "Kenyan phone",
      supported_language: "en",
      supported_entity: "KE_PHONE_NUMBER",
      patterns: [
        {
          name: "plus-254-or-local",
          regex:
            "(?<!\\d)(?:\\+?254|0)[-.\\s]?(?:7|1)\\d[-.\\s]?\\d{3}[-.\\s]?\\d{3,4}(?!\\d)",
          score: 0.7,
        },
      ],
      context: ["phone", "simu", "call", "nipigie", "mobile"],
    },
    {
      name: "Kenyan national ID",
      supported_language: "en",
      supported_entity: "KE_NATIONAL_ID",
      patterns: [
        {
          name: "id-with-context",
          regex:
            "(?:national\\s*id|kitambulisho|nida|id(?:\\s*number)?)\\s*[:#]?\\s*(\\d{7,8})",
          score: 0.6,
        },
      ],
      context: ["id", "kitambulisho", "nida"],
    },
  ];

  if (organizationIdentifiers.length > 0) {
    recognizers.push({
      name: "Organization identifiers",
      supported_language: "en",
      supported_entity: "KE_ORG_ID",
      deny_list: organizationIdentifiers,
    });
  }

  return recognizers;
}
