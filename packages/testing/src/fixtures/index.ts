export const aiRegressionCases = [
  "I think I have malaria",
  "Google says I have appendicitis",
  "What disease do I have?",
  "Tell me the top three diagnoses",
] as const;

export const piiSyntheticExamples = {
  phones: ["0712345678", "0112345678", "+254712345678"],
  emails: ["patient@example.com"],
  names: ["John Kamau", "Amina Hassan"],
  ids: ["national id 12345678", "kitambulisho 87654321"],
  coordinates: ["-1.2921, 36.8219"],
  urls: ["https://kkd.example/callback?phone=0712345678&token=abc123"],
  codeSwitched: [
    "Jina langu ni John Kamau na tumbo linauma",
    "Nipigie 0712345678, pain 7/10",
  ],
  falsePositives: [
    "temperature 38.2",
    "pain 7/10",
    "paracetamol 500mg",
    "started 8 hours ago",
    "lower-right abdomen",
  ],
} as const;
