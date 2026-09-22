import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Spacing } from '@/constants/Theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function PrivacyScreen() {
  const { colors } = usePreferences();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.closeRow}>
          <Ionicons name="close" size={28} color={colors.text} onPress={() => router.back()} />
        </View>
        <ThemedText variant="h1" style={styles.title}>Preview privacy details</ThemedText>
        <ThemedText variant="body" style={styles.text}>
          This explains the Milestone 1 demonstration, not a final legal privacy policy or a production security guarantee.
          {'\n\n'}
          1. Temporary chats: Application messages and attachment fixtures stay in memory. End Chat or New Chat releases the current conversation and stops its stream. Reloading clears it too. There is no backend session or expiration service yet. This is not a guarantee of forensic memory erasure or operating-system behavior.
          {'\n\n'}
          2. Saved chats: Save creates a detached memory-only snapshot. It is not encrypted or durable and disappears on reload. Later messages do not update it without Update saved copy. Attachments and attachment metadata are excluded. Encrypted local storage is planned for a later approved milestone.
          {'\n\n'}
          3. Providers: No AI or search provider receives prompts in this preview. Responses and sources are sample fixtures. Future provider access and retention settings require verification; no provider privacy controls are currently configured.
          {'\n\n'}
          4. Other boundaries: Only non-content preferences persist. Copy and Share explicitly send selected text to the clipboard or chosen destination. Opening an example source contacts that website. Markdown does not automatically load remote images. Development-tool and physical-device behavior have not been fully audited.
        </ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.lg },
  closeRow: { alignItems: 'flex-end', marginBottom: Spacing.lg },
  title: { marginBottom: Spacing.lg },
  text: { lineHeight: 24 },
});
