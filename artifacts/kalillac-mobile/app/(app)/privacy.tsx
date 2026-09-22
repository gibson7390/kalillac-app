import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Spacing, Radii } from '@/constants/Theme';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';

export default function PrivacyScreen() {
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
        <ThemedText variant="h1" style={styles.title}>Privacy</ThemedText>
        <ThemedText variant="body" color="secondary" style={styles.subtitle}>
          This explains the Milestone 1B demonstration. It is not a final legal policy or production security guarantee.
        </ThemedText>

        <Section title="Temporary Chats">
          Application messages and attachments stay in memory only. End Chat releases the current conversation. Reloading clears them. There is no backend session. (Not a guarantee of forensic OS memory erasure).
        </Section>

        <Section title="Saved Chats">
          Save creates a detached memory-only snapshot. It is not encrypted or durable and disappears on reload. Later messages do not update it unless you choose Update saved copy.
        </Section>

        <Section title="Providers">
          No AI or search provider receives prompts in this preview. Responses are mock fixtures. Future provider access will require verification.
        </Section>

        <Section title="Other Boundaries">
          Only non-content preferences persist. Copy/Share send text to your clipboard/destination explicitly. Opening an example source contacts that website. Remote markdown images are blocked.
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string, children: string }) {
  const { colors } = usePreferences();
  return (
    <View style={[styles.section, { backgroundColor: colors.surfaceSecondary }]}>
      <ThemedText variant="body" weight="semiBold" style={styles.sectionTitle}>{title}</ThemedText>
      <ThemedText variant="bodySm" color="secondary" style={styles.sectionText}>{children}</ThemedText>
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
  section: {
    padding: Spacing.md,
    borderRadius: Radii.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: { marginBottom: Spacing.xs },
  sectionText: { lineHeight: 20 },
});
