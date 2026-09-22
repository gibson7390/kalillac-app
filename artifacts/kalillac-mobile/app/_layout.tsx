import React, { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { ChatRepositoryProvider } from '@/contexts/ChatRepositoryContext';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { reduceMotion } = usePreferences();
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? 'none' : 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <PreferencesProvider>
                <SubscriptionProvider>
                  <ChatRepositoryProvider>
                    <InnerLayout />
                  </ChatRepositoryProvider>
                </SubscriptionProvider>
              </PreferencesProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function InnerLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const { isLoaded } = usePreferences();

  useEffect(() => {
    if ((fontsLoaded || fontError) && isLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, isLoaded]);

  if (!fontsLoaded && !fontError) return null;
  if (!isLoaded) return null;

  return <RootLayoutNav />;
}
