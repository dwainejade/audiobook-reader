import { create } from 'zustand';
import { light, dark, type Theme } from '../lib/theme';

type ThemeStore = {
  isDark: boolean;
  theme: Theme;
  toggle: () => void;
};

export const useThemeStore = create<ThemeStore>((set) => ({
  isDark: false,
  theme: light,
  toggle: () =>
    set((s) => ({
      isDark: !s.isDark,
      theme: s.isDark ? light : dark,
    })),
}));
