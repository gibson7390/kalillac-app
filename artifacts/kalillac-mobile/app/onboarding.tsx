import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { Spacing } from '@/constants/Theme';
import { Redirect, router } from 'expo-router';

export default function OnboardingScreen() {
  const { colors, hasOnboarded, completeOnboarding } = usePreferences();
  const insets = useSafeAreaInsets();

  if (hasOnboarded) {
    return <Redirect href="/(app)/(tabs)" />;
  }

  const handleStart = () => {
    completeOnboarding();
    router.replace('/(app)/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText variant="display" style={styles.title}>
            Kalillac
          </ThemedText>
          <ThemedText variant="body" color="secondary" style={styles.subtitle}>
            A private-by-default workspace for your intelligence. (Milestone 1 Demo)
          </ThemedText>
        </View>

        <View style={styles.features}>
          <FeatureItem
            title="Private by Design"
            description="Your temporary conversations vanish automatically. Save only what you explicitly choose."
            icon="shield-outline"
          />
          <FeatureItem
            title="Local Encryption (Pending)"
            description="For this preview, saved snapshots are strictly in memory. True encryption will be implemented in a later milestone."
            icon="lock-closed-outline"
          />
          <FeatureItem
            title="Calm & Focused"
            description="A premium interface without distractions. Mock models are used for this frontend shell."
            icon="leaf-outline"
          />
        </View>
      </View>

      <View style={styles.footer}>
        <ThemedText variant="caption" color="tertiary" align="center" style={styles.disclaimer}>
          This is a frontend shell preview. No real telemetry, models, or legal agreements are active.
        </ThemedText>
        <Button
          title="Start Workspace"
          onPress={handleStart}
          size="lg"
          style={styles.button}
        />
      </View>
    </View>
  );
}

function FeatureItem({ title, description, icon }: { title: string, description: string, icon: any }) {
  const { colors } = usePreferences();
  return (
    <View style={styles.featureItem}>
      <View style={[styles.iconContainer, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={24} color={colors.text} />
      </View>
      <View style={styles.featureText}>
        <ThemedText variant="body" weight="semiBold">{title}</ThemedText>
        <ThemedText variant="bodySm" color="secondary" style={{ marginTop: 2 }}>{description}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  header: {
    marginBottom: Spacing.xxl,
  },
  title: {
    marginBottom: Spacing.sm,
  },
  subtitle: {
    lineHeight: 24,
  },
  features: {
    gap: Spacing.xl,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
  disclaimer: {
    marginBottom: Spacing.xs,
  },
  button: {
    width: '100%',
  },
});
