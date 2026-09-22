import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { Spacing, Radii } from '@/constants/Theme';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';

export default function PaywallScreen() {
  const { colors } = usePreferences();
  const { status, purchasePlus, restorePurchases } = useSubscription();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handlePurchase = async () => {
    Alert.alert('Simulate Purchase', 'Choose the simulated outcome for this transaction:', [
      { text: 'Cancel Action', style: 'cancel' },
      { text: 'User Cancelled IAP', onPress: () => execPurchase('cancel') },
      { text: 'Fail Transaction', style: 'destructive', onPress: () => execPurchase('fail') },
      { text: 'Succeed', onPress: () => execPurchase('success') }
    ]);
  };

  const execPurchase = async (outcome: 'cancel' | 'fail' | 'success') => {
    if (outcome === 'cancel') return;
    setIsPurchasing(true);
    try {
      if (outcome === 'fail') throw new Error('Transaction declined or cancelled by user.');
      await purchasePlus();
      Alert.alert('Success', 'You are now subscribed to Kalillac Plus.');
      router.back();
    } catch (e: any) {
      Alert.alert('Purchase Failed', e.message || 'Something went wrong.');
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    Alert.alert('Simulate Restore', 'Choose the simulated outcome:', [
      { text: 'Cancel Action', style: 'cancel' },
      { text: 'Active Purchase', onPress: () => execRestore('active') },
      { text: 'No Purchases Found', style: 'destructive', onPress: () => execRestore('empty') },
      { text: 'Network Failure', style: 'destructive', onPress: () => execRestore('fail') }
    ]);
  };

  const execRestore = async (outcome: 'active' | 'empty' | 'fail') => {
    setIsRestoring(true);
    try {
      if (outcome === 'empty') throw new Error('No previous purchases found.');
      if (outcome === 'fail') throw new Error('Simulated network failure. No App Store connection was attempted.');
      await restorePurchases();
      Alert.alert('Demo restore complete', 'A mock Plus entitlement is active in memory. No real purchase was restored.');
      router.back();
    } catch (e: any) {
      Alert.alert('Restore Failed', e.message || 'No active subscription found.');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.closeRow}>
          <Ionicons name="close" size={28} color={colors.text} onPress={() => router.back()} />
        </View>

        <View style={styles.header}>
          <ThemedText variant="display" style={{ color: colors.accent }}>Kalillac Plus</ThemedText>
          <ThemedText variant="body" color="secondary" style={styles.subtitle}>
            Preview the planned Plus experience. All benefits, purchases and allowances here are simulated. No charge, subscription or real AI processing occurs.
          </ThemedText>
        </View>

        <View style={styles.features}>
          <Feature icon="planet" title="Planned: Smart & Deep" description="Mock responses today. Future premium use will have limits, not unlimited Deep." />
          <Feature icon="document-text" title="Planned: Files & Images" description="Attachment fixtures only; no real upload or analysis in this shell." />
          <Feature icon="search" title="Planned: More Research" description="Sample citations only. Live search is not connected." />
          <Feature icon="shield-checkmark" title="Planned: Ad-Free Plus" description="No advertising SDK in this preview. Production privacy claims await verification." />
        </View>

        <View style={[styles.pricingCard, { backgroundColor: colors.surfaceSecondary }]}>
          <ThemedText variant="h2">$7.99 / month</ThemedText>
          <ThemedText variant="caption" color="secondary">Provisional price only. No real subscription is offered here.</ThemedText>
        </View>

        <View style={styles.actions}>
          <Button 
            title={status === 'plus' ? 'Demo Plus active' : 'Simulate subscription'} 
            onPress={handlePurchase} 
            size="lg" 
            disabled={status === 'plus' || isPurchasing || isRestoring}
            loading={isPurchasing}
          />
          <Button 
            title="Restore Purchases (demo)" 
            variant="ghost" 
            onPress={handleRestore} 
            disabled={isPurchasing || isRestoring}
            loading={isRestoring}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Feature({ icon, title, description }: { icon: any, title: string, description: string }) {
  const { colors } = usePreferences();
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon} size={24} color={colors.text} />
      <View style={styles.featureText}>
        <ThemedText variant="body" weight="semiBold">{title}</ThemedText>
        <ThemedText variant="caption" color="secondary">{description}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  closeRow: { alignItems: 'flex-end', marginBottom: Spacing.lg },
  header: { marginBottom: Spacing.xl },
  subtitle: { marginTop: Spacing.sm, lineHeight: 22 },
  features: { gap: Spacing.lg, marginBottom: Spacing.xl },
  featureRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  featureText: { flex: 1 },
  pricingCard: { padding: Spacing.lg, borderRadius: Radii.lg, alignItems: 'center', marginBottom: Spacing.xl },
  actions: { gap: Spacing.sm },
});
