import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { Spacing, Radii } from '@/constants/Theme';
import { Redirect, router } from 'expo-router';
import { BrandLockup } from '@/components/BrandLockup';

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
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <BrandLockup />
          <ThemedText variant="body" color="secondary" style={styles.subtitle}>
            A focused workspace with temporary, memory-only conversations.
          </ThemedText>
        </View>

        <View style={styles.features}>
          <FeatureItem
            title="Temporary by Default"
            description="Chats stay in memory until you end or clear them. Nothing is saved unless you choose it."
            icon="shield-checkmark-outline"
          />
          <FeatureItem
            title="Explicit Snapshots"
            description="Saved copies are separate, memory-only snapshots and clear when the app reloads."
            icon="albums-outline"
          />
          <FeatureItem
            title="Calm & Focused"
            description="A premium interface designed without distractions for deep thinking."
            icon="sparkles-outline"
          />
        </View>
      </View>

      <View style={styles.footer}>
        <ThemedText variant="caption" color="tertiary" align="center" style={styles.disclaimer}>
          Private by default. Save only what you choose.
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
      <View style={[styles.iconContainer, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={styles.featureText}>
        <ThemedText variant="body" weight="medium">{title}</ThemedText>
        <ThemedText variant="bodySm" color="secondary" style={{ marginTop: 4 }}>{description}</ThemedText>
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
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
  },
  header: {
    marginBottom: Spacing.xxl,
  },
  subtitle: {
    marginTop: Spacing.md,
    lineHeight: 24,
  },
  features: {
    gap: Spacing.xl,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
    paddingTop: 2,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  disclaimer: {
    marginBottom: Spacing.xs,
  },
  button: {
    width: '100%',
  },
});
