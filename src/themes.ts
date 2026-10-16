export type CodeTheme = 'one-light' | 'github-dark';
export function resolveCodeTheme(value: unknown): CodeTheme {
  return value === 'github-dark' ? 'github-dark' : 'one-light';
}
