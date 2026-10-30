const RACE_WORDS = "black|white|asian|african|indian|latino|latina|hispanic|arab|native|chinese|japanese|korean|mexican";

// Needs a person as the subject, so "make the glasses look white" stays a colour request.
const LOOKS_LIKE = `(look|appear)\\s+(more\\s+)?(${RACE_WORDS})\\b`;

const PATTERNS = [
  /\b(black|brown|yellow|red)[\s-]?face\b/,
  /\b(darken|lighten|whiten|bleach|tan)\w*\s+(my|the|her|his|their)?\s*(skin|face|complexion)\b/,
  /\b(darker|lighter|whiter|paler|blacker|browner|tanner)\s+(skin|complexion|skin\s?tone)\b/,
  /\b(change|swap|switch|replace)\w*\s+(my|the|her|his|their)?\s*(skin|complexion)\s*(tone|colou?r)?\b/,
  new RegExp(`\\b(make|turn)\\s+(me|my face|him|her)\\s+(look\\s+)?(like\\s+)?(an?\\s+)?(${RACE_WORDS})\\b`),
  new RegExp(`\\b(i|i'd|me|us|we|him|her|skin|face|complexion)\\s+(to\\s+|can\\s+|could\\s+|should\\s+)?${LOOKS_LIKE}`),
  new RegExp(`\\b(want|wanna|like|love|need|try|trying|how)\\s+(to\\s+)?${LOOKS_LIKE}`),
  new RegExp(`^${LOOKS_LIKE}`),
  new RegExp(`\\b(${RACE_WORDS})\\s+(skin|complexion|skin\\s?tone)\\b`),
];

export function asksToChangeSkinTone(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  return PATTERNS.some((pattern) => pattern.test(normalized));
}
