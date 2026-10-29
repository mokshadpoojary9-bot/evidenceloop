// Client-side checks for the sign-in form. Supabase Auth still decides; these only catch typos
// early and say exactly what is wrong.

export const PASSWORD_MIN_LENGTH = 8;

/** One "@", something before it, and a dotted domain after it, with no spaces. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** An error message, or null when the address looks valid. */
export function emailError(value: string): string | null {
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (!EMAIL.test(email)) return 'Enter a valid email address, like name@example.com.';
  return null;
}

/** New passwords: at least 8 characters, with at least one letter and one number. */
export function newPasswordError(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/\p{L}/u.test(value)) return 'Include at least one letter.';
  if (!/\p{N}/u.test(value)) return 'Include at least one number.';
  return null;
}

/** Signing in only needs a password to be entered; the rules apply to new passwords. */
export function currentPasswordError(value: string): string | null {
  return value ? null : 'Enter your password.';
}
