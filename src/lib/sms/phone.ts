/**
 * Converts Persian (Farsi) and Arabic numeric characters to standard English ASCII digits.
 */
export function convertDigitsToEnglish(input: string): string {
  if (!input) return '';
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

  let result = input;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(persianDigits[i], 'g'), i.toString());
    result = result.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }
  return result;
}

/**
 * Normalizes any common Iranian mobile number format into standard canonical format:
 * Exactly 11 digits starting with "09" (e.g., 09123456789).
 * Returns null if the number is invalid.
 */
export function normalizeIranianPhone(rawPhone: string): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return null;
  }

  // 1. Convert any Persian or Arabic numerals
  let cleaned = convertDigitsToEnglish(rawPhone.trim());

  // 2. Strip whitespace, hyphens, parentheses, and leading plus
  cleaned = cleaned.replace(/[\s\-\(\)\.]+/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // 3. Normalize international prefixes
  // e.g. 00989123456789 -> 09123456789
  if (cleaned.startsWith('0098')) {
    cleaned = '0' + cleaned.substring(4);
  }
  // e.g. 989123456789 -> 09123456789
  else if (cleaned.startsWith('98') && cleaned.length === 12) {
    cleaned = '0' + cleaned.substring(2);
  }
  // e.g. 9123456789 (10 digits) -> 09123456789
  else if (cleaned.startsWith('9') && cleaned.length === 10) {
    cleaned = '0' + cleaned;
  }

  // 4. Validate exact Iranian mobile regex: ^09\d{9}$
  if (/^09\d{9}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

/**
 * Safely masks a phone number for logs and public displays without revealing full identity.
 * e.g., "09123456789" -> "0912***6789"
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return '***';
  return `${phone.substring(0, 4)}***${phone.substring(phone.length - 4)}`;
}
