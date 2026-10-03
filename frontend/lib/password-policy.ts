/**
 * password-policy.ts
 * Single source of truth for CIVIL-LEX password requirements.
 * Applied on signup, reset-password and change-password (never on login,
 * so existing accounts with older passwords can still sign in).
 */

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "upper", label: "One uppercase letter (A-Z)", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "One lowercase letter (a-z)", test: (p) => /[a-z]/.test(p) },
  { id: "digit", label: "One number (0-9)", test: (p) => /\d/.test(p) },
  {
    id: "special",
    label: "One special character (e.g. ! @ # $ %)",
    test: (p) => /[^A-Za-z0-9\s]/.test(p),
  },
  { id: "space", label: "No spaces", test: (p) => !/\s/.test(p) },
];

/** Returns the first unmet rule's message, or null if the password is valid. */
export function validatePassword(password: string): string | null {
  const failed = PASSWORD_RULES.find((rule) => !rule.test(password));
  if (!failed) return null;
  return `Password requirement not met: ${failed.label.toLowerCase()}.`;
}

/** 0-4 strength score based on how many rules are met. */
export function getPasswordStrength(password: string): {
  score: number;
  label: string;
} {
  if (!password) return { score: 0, label: "" };
  const met = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const ratio = met / PASSWORD_RULES.length;
  if (ratio < 0.5) return { score: 1, label: "Weak" };
  if (ratio < 0.85) return { score: 2, label: "Fair" };
  if (ratio < 1) return { score: 3, label: "Good" };
  return { score: 4, label: "Strong" };
}
