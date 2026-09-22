import React, { useEffect, useState, useRef } from 'react';
import { AppState, View, StyleSheet, AppStateStatus } from 'react-native';
import { BlurView } from 'expo-blur';
import { usePreferences } from '@/contexts/PreferencesContext';
import { Stack } from 'expo-router';

function PrivacyOverlay() {
  const [isActive, setIsActive] = useState(false);
  const { isDark, colors } = usePreferences();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // Inactive is the state when app switcher is shown on iOS
      if (appState.current.match(/active/) && nextAppState === 'inactive') {
        setIsActive(true);
      } else if (nextAppState === 'active') {
        setIsActive(false);
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (!isActive) return null;

  return (
    <BlurView
      intensity={100}
      tint={isDark ? 'dark' : 'light'}
      style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)' }]}
    />
  );
}

export default function AppLayout() {
  const { colors, reduceMotion } = usePreferences();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? 'none' : 'default' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'default' }} />
        <Stack.Screen name="privacy" options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'default' }} />
        <Stack.Screen name="providers" options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'default' }} />
      </Stack>
      <PrivacyOverlay />
    </View>
  );
}
