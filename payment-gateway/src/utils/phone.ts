// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Phone Number Utilities
// ═══════════════════════════════════════════════════════════════════════

/**
 * Valid Kenyan M-Pesa phone number prefixes.
 * M-Pesa operates on Safaricom (07XX, 01XX) numbers.
 */
const SAFARICOM_PREFIXES = [
  '070', '071', '072', '073', '074', '075', '076', '077', '078', '079',
  '010', '011', '012',
];

/**
 * Validate that a phone number is a valid Kenyan Safaricom number.
 * Accepts formats: 0712345678, +254712345678, 254712345678
 */
export function isValidKenyanPhone(phone: string): boolean {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Format: 07XXXXXXXX or 01XXXXXXXX (10 digits)
  if (digits.length === 10 && digits.startsWith('0')) {
    const prefix = digits.slice(0, 3);
    return SAFARICOM_PREFIXES.includes(prefix);
  }

  // Format: 2547XXXXXXXX or 2541XXXXXXXX (12 digits)
  if (digits.length === 12 && digits.startsWith('254')) {
    const prefix = digits.slice(2, 5);
    return SAFARICOM_PREFIXES.includes(prefix);
  }

  // Format: +2547XXXXXXXX (13 chars with +)
  if (phone.startsWith('+') && digits.length === 12 && digits.startsWith('254')) {
    const prefix = digits.slice(2, 5);
    return SAFARICOM_PREFIXES.includes(prefix);
  }

  return false;
}

/**
 * Format a Kenyan phone number to the 254XXXXXXXXX format
 * required by Safaricom's Daraja API.
 *
 * Accepts: 0712345678, +254712345678, 254712345678
 * Returns: 254712345678
 */
export function formatPhoneForDaraja(phone: string): string {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Already in 254XXXXXXXXX format
  if (digits.length === 12 && digits.startsWith('254')) {
    return digits;
  }

  // Local format: 07XXXXXXXX → 254XXXXXXXX
  if (digits.length === 10 && digits.startsWith('0')) {
    return '254' + digits.slice(1);
  }

  // Shouldn't reach here if validation passed, but handle gracefully
  if (digits.startsWith('254')) {
    return digits;
  }

  return '254' + digits;
}

/**
 * Mask a phone number for display/logging purposes.
 * 254712345678 → 254****5678
 */
export function maskPhone(phone: string): string {
  const formatted = formatPhoneForDaraja(phone);
  if (formatted.length < 8) return '****';
  return (
    formatted.slice(0, 3) +
    '****' +
    formatted.slice(-4)
  );
}
