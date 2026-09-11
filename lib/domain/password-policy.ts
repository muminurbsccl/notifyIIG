const MIN_LENGTH = 8;

// Common breached/guessable passwords that trivially satisfy a bare length
// check; blocking them is cheap and meaningfully raises the floor.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "letmein1",
  "welcome1",
  "admin123",
  "iloveyou",
  "abc12345",
  "changeme",
  "12345678a",
]);

export function validatePassword(password: string): string | null {
  if (password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "Password is too common; choose a less predictable one";

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 2) return "Password must mix at least two of: lowercase, uppercase, numbers, symbols";

  return null;
}
