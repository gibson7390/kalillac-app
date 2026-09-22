import { Redirect } from 'expo-router';
import { usePreferences } from '@/contexts/PreferencesContext';

export default function Index() {
  const { hasOnboarded, isLoaded } = usePreferences();

  if (!isLoaded) return null;

  if (!hasOnboarded) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(app)/(tabs)" />;
}
