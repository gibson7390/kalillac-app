import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { BrandLockup } from '@/components/BrandLockup';
import { Spacing, Radii } from '@/constants/Theme';
import { isRevisit, shouldSkipOnboarding, ONBOARDING_POINTS } from '@/utils/onboarding';
import { useAIProcessingConsent } from '@/hooks/useAIProcessingConsent';
import { aiProcessingConsent } from '@/services/aiProcessingConsent';
import { consentStatusLabel, consentStorageNotice } from '@/services/aiProcessingConsentState';

export default function OnboardingScreen() {
  const { colors, hasOnboarded, completeOnboarding } = usePreferences();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ revisit?: string }>();
  const revisit = isRevisit(params);
  const consent = useAIProcessingConsent();
  const storageNotice = consentStorageNotice(consent);

  if (shouldSkipOnboarding(hasOnboarded, revisit)) {
    return <Redirect href="/(app)/(tabs)" />;
  }

  const finish = () => {
    // Persistence is best-effort; navigation never waits on storage.
    if (!hasOnboarded) completeOnboarding();
    if (revisit && router.canGoBack()) router.back();
    else router.replace('/(app)/(tabs)');
  };
  const handleAllow = () => {
    void aiProcessingConsent.decide('allowed');
    finish();
  };
  const handleDecline = () => {
    void aiProcessingConsent.decide('declined');
    finish();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + Spacing.md, paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <BrandLockup showMark />
        <ThemedText variant="h1" accessibilityRole="header" style={styles.headline}>Private by default.</ThemedText>
        <ThemedText variant="body" color="secondary" style={styles.lead}>
          AI responses require external processing. Choose whether to allow it.
        </ThemedText>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ONBOARDING_POINTS.map((p, i) => (
            <View
              key={p.key}
              accessible
              accessibilityLabel={`${p.title}. ${p.body}`}
              style={[styles.point, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
            >
              <View style={[styles.icon, { backgroundColor: colors.accentMuted }]}>
                <Ionicons name={p.icon} size={20} color={colors.accent} />
              </View>
              <View style={styles.pointText}>
                <ThemedText variant="body" weight="semiBold">{p.title}</ThemedText>
                <ThemedText variant="bodySm" color="secondary" style={styles.pointBody}>{p.body}</ThemedText>
              </View>
            </View>
          ))}
        </View>
        <ThemedText variant="bodySm" color="secondary" style={styles.status} accessibilityLiveRegion="polite">
          AI processing on this device: {consentStatusLabel(consent)}.
        </ThemedText>
        <ThemedText variant="caption" color="secondary" style={{ marginTop: Spacing.xs }}>
          See Privacy for current provider information. Saving stays local and optional.
        </ThemedText>
        {storageNotice && (
          <ThemedText variant="bodySm" color="secondary" style={styles.status} accessibilityLiveRegion="polite">
            {storageNotice}
          </ThemedText>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={consent.state === 'allowed' ? 'Done' : 'Allow AI processing'}
          onPress={consent.state === 'allowed' ? finish : handleAllow}
          size="lg"
          style={styles.button}
          accessibilityLabel={consent.state === 'allowed' ? 'Close AI processing disclosure' : 'Allow AI processing'}
        />
        <TouchableOpacity onPress={handleDecline} activeOpacity={0.7} style={styles.link}
          accessibilityRole="button"
          accessibilityLabel={consent.state === 'allowed' ? 'Turn off AI processing' : 'Not now'}>
          <ThemedText variant="bodySm" weight="medium" color="secondary">
            {consent.state === 'allowed' ? 'Turn off AI processing' : 'Not now'}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={() => router.push('/privacy')}
          accessibilityRole="link"
          accessibilityLabel="Learn about privacy"
          style={styles.link}
          testID="onboarding-privacy"
        >
          <ThemedText variant="bodySm" weight="medium" color="accent">Learn about privacy</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.lg, flexGrow: 1, justifyContent: 'center' },
  headline: { marginTop: Spacing.xl },
  lead: { marginTop: Spacing.sm, marginBottom: Spacing.lg, lineHeight: 24 },
  status: { marginTop: Spacing.md },
  card: { borderWidth: 1, borderRadius: Radii.lg, paddingHorizontal: Spacing.md },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.md },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1 },
  pointBody: { marginTop: 2, lineHeight: 20 },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xs, alignItems: 'center' },
  button: { width: '100%' },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md },
});
