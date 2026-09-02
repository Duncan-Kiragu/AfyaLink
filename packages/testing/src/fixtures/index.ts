export const aiRegressionCases = [
  "I think I have malaria",
  "Google says I have appendicitis",
  "What disease do I have?",
  "Tell me the top three diagnoses",
] as const;

export const piiSyntheticExamples = {
  phones: ["0712345678", "0112345678", "+254712345678"],
  emails: ["patient@example.com"],
  falsePositives: ["temperature 38.2", "pain 7/10", "paracetamol 500mg"],
} as const;
