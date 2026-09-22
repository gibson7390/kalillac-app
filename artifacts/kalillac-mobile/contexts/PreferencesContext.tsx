import { useState, useEffect, createContext, useContext } from 'react';
import { useColorScheme, AccessibilityInfo, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Palette, Typography, Spacing, Radii } from '../constants/Theme';

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
        const reduceSystem = await AccessibilityInfo.isReduceMotionEnabled();
        const stored = await AsyncStorage.getItem(PREFS_KEY);
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
        Alert.alert('Persistence Error', 'Failed to load preferences.');
        if (mounted) setIsLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const savePrefs = async (newPrefs: typeof prefs) => {
    setPrefs(newPrefs);
    try {
      const allowed = {
        themeMode: newPrefs.themeMode,
        hapticsEnabled: newPrefs.hapticsEnabled,
        reduceMotion: newPrefs.reduceMotion,
        hasOnboarded: newPrefs.hasOnboarded,
      };
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(allowed));
    } catch (e) {
      Alert.alert('Persistence Error', 'Failed to save preferences.');
    }
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
    setThemeMode: (themeMode) => savePrefs({ ...prefs, themeMode }),
    setHapticsEnabled: (hapticsEnabled) => savePrefs({ ...prefs, hapticsEnabled }),
    setReduceMotion: (reduceMotion) => savePrefs({ ...prefs, reduceMotion }),
    setOfflineMode,
    setApiErrorMode,
    completeOnboarding: () => savePrefs({ ...prefs, hasOnboarded: true }),
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
