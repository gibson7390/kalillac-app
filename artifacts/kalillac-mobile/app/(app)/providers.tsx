import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Spacing, Radii } from '@/constants/Theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function ProvidersScreen() {
  const { colors } = usePreferences();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.closeRow}>
          <Ionicons name="close" size={28} color={colors.text} onPress={() => router.back()} />
        </View>
        <ThemedText variant="h1" style={styles.title}>Planned providers</ThemedText>
        <ThemedText variant="body" style={styles.title}>Milestone 1 preview: no AI or search provider is connected. All answers and citations are simulated. The plans below are not active capabilities or verified retention guarantees.</ThemedText>
        
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
          <ThemedText variant="h2">Groq</ThemedText>
          <ThemedText variant="bodySm" color="secondary">Planned for Fast mode</ThemedText>
          <ThemedText variant="caption" style={styles.mt}>Groq gpt-oss-120b is the planned model. Availability and Zero Data Retention eligibility and configuration must be verified before production traffic. Nothing is configured in this preview.</ThemedText>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
          <ThemedText variant="h2">OpenAI</ThemedText>
          <ThemedText variant="bodySm" color="secondary">Planned for Smart and Deep modes</ThemedText>
          <ThemedText variant="caption" style={styles.mt}>Exact model availability and privacy terms remain unverified. Future temporary requests are planned to use store=false where supported. That flag is not a zero-retention guarantee. No OpenAI requests occur here.</ThemedText>
        </View>
        
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
          <ThemedText variant="h2">Brave Search</ThemedText>
          <ThemedText variant="bodySm" color="secondary">Preferred future search option</ThemedText>
          <ThemedText variant="caption" style={styles.mt}>Subject to commercial and privacy review, with Tavily as an alternative. The planned integration sends a minimized query, never the full conversation. This preview performs no search.</ThemedText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.lg },
  closeRow: { alignItems: 'flex-end', marginBottom: Spacing.lg },
  title: { marginBottom: Spacing.lg },
  card: { padding: Spacing.md, borderRadius: Radii.lg, marginBottom: Spacing.md },
  mt: { marginTop: Spacing.sm },
});
