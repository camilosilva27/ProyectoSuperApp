const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esEmailValido(email: string): boolean {
  return REGEX_EMAIL.test(email.trim());
}
