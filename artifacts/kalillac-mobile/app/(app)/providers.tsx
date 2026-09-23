import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Spacing, Radii } from '@/constants/Theme';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';

export default function ProvidersScreen() {
  const { colors } = usePreferences();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.closeRow}>
          <TouchableOpacity 
            onPress={() => router.back()} 
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ThemedText variant="h1" style={styles.title}>AI Providers</ThemedText>
        <ThemedText variant="body" color="secondary" style={styles.subtitle}>
          Development connection: OpenRouter is reached through the Kalillac backend. All four modes currently use the configured development model.
        </ThemedText>

        <ProviderCard
          name="OpenRouter"
          role="Auto, Fast, Smart & Deep"
          status="Development"
          description="The backend keeps the provider credential server-side and sends the current conversation for a non-streaming answer. Mode selection is preserved for future routing; it does not select different models yet."
        />
        
        <ProviderCard 
          name="Groq" 
          role="Fast mode" 
          status="Planned"
          description="Groq Llama model is planned. Zero Data Retention eligibility must be verified before production. Nothing is configured in this preview." 
        />

        <ProviderCard 
          name="OpenAI" 
          role="Smart & Deep modes" 
          status="Planned"
          description="Model availability and privacy terms remain unverified. Temporary requests are planned to use store=false where supported. No OpenAI requests occur here." 
        />
        
        <ProviderCard 
          name="Search (TBD)" 
          role="Research feature" 
          status="Planned"
          description="Subject to commercial and privacy review. The planned integration sends a minimized query, never the full conversation. This preview performs no live search." 
        />
      </ScrollView>
    </View>
  );
}

function ProviderCard({ name, role, status, description }: { name: string, role: string, status: string, description: string }) {
  const { colors } = usePreferences();
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.cardHeader}>
        <View>
          <ThemedText variant="h2">{name}</ThemedText>
          <ThemedText variant="bodySm" color="secondary">{role}</ThemedText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: colors.surface }]}>
          <ThemedText variant="caption" color="secondary">{status}</ThemedText>
        </View>
      </View>
      <ThemedText variant="caption" color="secondary" style={styles.mt}>{description}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  closeRow: { alignItems: 'flex-end', marginBottom: Spacing.md },
  closeBtn: { padding: Spacing.sm, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { marginBottom: Spacing.sm },
  subtitle: { marginBottom: Spacing.xl, lineHeight: 22 },
  card: { padding: Spacing.lg, borderRadius: Radii.lg, marginBottom: Spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radii.sm },
  mt: { marginTop: Spacing.md, lineHeight: 20 },
});
