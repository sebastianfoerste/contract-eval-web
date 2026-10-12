export type Theme = 'system' | 'light' | 'dark';
type ThemeRoot = { dataset: { theme?: string } };
type ThemeStorage = Pick<Storage, 'setItem' | 'removeItem'>;
const order: Theme[] = ['system', 'light', 'dark'];
export const nextTheme = (current: Theme): Theme => order[(order.indexOf(current) + 1) % order.length];

export function appliedTheme(root: ThemeRoot): Theme {
  return root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : 'system';
}

export function applyTheme(root: ThemeRoot, storage: () => ThemeStorage, theme: Theme): void {
  try {
    if (theme === 'system') storage().removeItem('theme');
    else storage().setItem('theme', theme);
  } catch { /* Storage denial must not prevent the visible setting from changing. */ }
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
