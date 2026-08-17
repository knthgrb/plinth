const UNICODE_LETTER_PATTERN = /\p{L}/u;
const DIGIT_PATTERN = /\p{N}/u;

export function hasEmployeeName(value: string): boolean {
  const normalized = value.trim();

  if (!normalized || DIGIT_PATTERN.test(normalized)) {
    return false;
  }

  return normalized
    .split(/\s+/u)
    .filter((part) => UNICODE_LETTER_PATTERN.test(part)).length >= 2;
}
