import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { light, dark, type Theme } from '../lib/theme';

export const FONT_SIZES = [14, 16, 18, 20, 22, 24] as const;
export type FontSize = (typeof FONT_SIZES)[number];

type ThemeStore = {
  isDark: boolean;
  theme: Theme;
  fontSize: FontSize;
  toggle: () => void;
  setFontSize: (size: FontSize) => void;
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      isDark: false,
      theme: light,
      fontSize: 18,
      toggle: () =>
        set((s) => ({
          isDark: !s.isDark,
          theme: s.isDark ? light : dark,
        })),
      setFontSize: (size) => set({ fontSize: size }),
    }),
    {
      name: 'theme-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ isDark: s.isDark, fontSize: s.fontSize }),
      onRehydrateStorage: () => (state) => {
        // Restore theme object from persisted isDark flag
        if (state) state.theme = state.isDark ? dark : light;
      },
    },
  ),
);
