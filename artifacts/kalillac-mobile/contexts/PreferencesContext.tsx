import { useState, useEffect, createContext, useContext } from 'react';
import { useColorScheme, AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Palette, Typography, Spacing, Radii } from '../constants/Theme';
import { safeReadPrefs, safeWritePrefs, applyOnboardingComplete } from '../utils/onboarding';

type ThemeMode = 'light' | 'dark' | 'system';

interface PreferencesState {
  themeMode: ThemeMode;
  hapticsEnabled: boolean;
  reduceMotion: boolean;
  hasOnboarded: boolean;
  offlineMode: boolean;
  apiErrorMode: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setReduceMotion: (reduce: boolean) => void;
  setOfflineMode: (offline: boolean) => void;
  setApiErrorMode: (errorMode: boolean) => void;
  completeOnboarding: () => void;
  colors: typeof Palette.light;
  isDark: boolean;
  isLoaded: boolean;
}

const PREFS_KEY = '@kalillac_prefs';

const defaultPreferences: Omit<PreferencesState, 'colors' | 'isDark' | 'isLoaded' | 'offlineMode' | 'apiErrorMode' | 'setThemeMode' | 'setHapticsEnabled' | 'setReduceMotion' | 'setOfflineMode' | 'setApiErrorMode' | 'completeOnboarding'> = {
  themeMode: 'system',
  hapticsEnabled: true,
  reduceMotion: false,
  hasOnboarded: false,
};

const PreferencesContext = createContext<PreferencesState | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [isLoaded, setIsLoaded] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [apiErrorMode, setApiErrorMode] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const reduceSystem = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
        const stored = await safeReadPrefs(AsyncStorage, PREFS_KEY);
        let loadedPrefs: Partial<typeof prefs> = {};
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.themeMode === 'string') loadedPrefs.themeMode = parsed.themeMode as ThemeMode;
            if (typeof parsed.hapticsEnabled === 'boolean') loadedPrefs.hapticsEnabled = parsed.hapticsEnabled;
            if (typeof parsed.reduceMotion === 'boolean') loadedPrefs.reduceMotion = parsed.reduceMotion;
            if (typeof parsed.hasOnboarded === 'boolean') loadedPrefs.hasOnboarded = parsed.hasOnboarded;
          }
        }
        if (mounted) {
          setPrefs((prev) => ({ ...prev, reduceMotion: reduceSystem, ...loadedPrefs }));
          setIsLoaded(true);
        }
      } catch (e) {
        // Storage failure must never block the app; fall back to defaults.
        if (__DEV__) console.warn('Preferences load failed; using defaults.');
        if (mounted) setIsLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const savePrefs = async (newPrefs: typeof prefs) => {
    // In-memory first: the UI never waits on storage.
    setPrefs(newPrefs);
    const ok = await safeWritePrefs(AsyncStorage, PREFS_KEY, {
      themeMode: newPrefs.themeMode,
      hapticsEnabled: newPrefs.hapticsEnabled,
      reduceMotion: newPrefs.reduceMotion,
      hasOnboarded: newPrefs.hasOnboarded,
    });
    if (!ok && __DEV__) console.warn('Preferences save failed; kept in memory only.');
  };

  const isDark = prefs.themeMode === 'system' ? systemColorScheme === 'dark' : prefs.themeMode === 'dark';
  const colors = isDark ? Palette.dark : Palette.light;

  const value: PreferencesState = {
    ...prefs,
    isDark,
    colors,
    isLoaded,
    offlineMode,
    apiErrorMode,
    setThemeMode: (themeMode) => void savePrefs({ ...prefs, themeMode }),
    setHapticsEnabled: (hapticsEnabled) => void savePrefs({ ...prefs, hapticsEnabled }),
    setReduceMotion: (reduceMotion) => void savePrefs({ ...prefs, reduceMotion }),
    setOfflineMode,
    setApiErrorMode,
    completeOnboarding: () => {
      const { next, changed } = applyOnboardingComplete(prefs);
      if (changed) void savePrefs(next);
    },
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}
