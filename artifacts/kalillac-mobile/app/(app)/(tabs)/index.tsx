import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { Spacing, Radii } from '@/constants/Theme';
import { router } from 'expo-router';
import { useChatRepository, AIModelMode, meaningfulActiveSessions } from '@/contexts/ChatRepositoryContext';
import { BrandLockup } from '@/components/BrandLockup';

export default function HomeTab() {
  const { colors } = usePreferences();
  const insets = useSafeAreaInsets();
  const { createSession, activeSessions } = useChatRepository();
  const resumableSessions = meaningfulActiveSessions(activeSessions);

  const handleNewChat = (mode: AIModelMode = 'Auto', task?: string) => {
    const id = createSession(mode);
    if (task) {
      router.push({ pathname: `/chat/${id}`, params: { task } } as any);
    } else {
      router.push(`/chat/${id}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <BrandLockup compact />
          <ThemedText variant="body" color="secondary" style={styles.subtitle}>Your private workspace.</ThemedText>
        </View>

        <TouchableOpacity 
          style={[styles.mockInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          onPress={() => handleNewChat('Auto')}
          accessibilityRole="button"
          accessibilityLabel="Start a new conversation"
        >
          <ThemedText variant="body" color="tertiary">Ask Kalillac anything...</ThemedText>
          <View style={[styles.mockInputBtn, { backgroundColor: colors.accent }]}>
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {resumableSessions.length > 0 && (
          <View style={styles.activeSection}>
            <ThemedText variant="caption" color="secondary" style={styles.sectionTitle}>
              ACTIVE CHATS
            </ThemedText>
            <View style={styles.activeList}>
              {resumableSessions.map((activeSession) => (
                <TouchableOpacity
                  key={activeSession.id}
                  style={[styles.activeRow, { borderBottomColor: colors.border }]}
                  onPress={() => router.push(`/chat/${activeSession.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Resume ${activeSession.title}`}
                >
                  <View style={[styles.iconBox, { backgroundColor: colors.accentMuted }]}>
                    <Ionicons name="chatbubble-outline" size={20} color={colors.accent} />
                  </View>
                  <View style={styles.actionRowText}>
                    <ThemedText variant="body" weight="medium" numberOfLines={1}>
                      {activeSession.title}
                    </ThemedText>
                    <ThemedText variant="caption" color="secondary">
                      Temporary · {activeSession.messages.length} {activeSession.messages.length === 1 ? 'message' : 'messages'}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <ThemedText variant="caption" color="secondary" style={styles.sectionTitle}>
          START WITH A TASK
        </ThemedText>

        <View style={styles.quickActions}>
          <ActionRow icon="search-outline" title="Research" description="Deep dive with citations" onPress={() => handleNewChat('Auto', 'Research')} />
          <ActionRow icon="code-slash-outline" title="Code" description="Explore a code example" onPress={() => handleNewChat('Auto', 'Code')} />
          <ActionRow icon="book-outline" title="Study" description="Explain complex topics" onPress={() => handleNewChat('Auto', 'Study')} />
          <ActionRow icon="flash-outline" title="Search" description="Explore sample sources" onPress={() => handleNewChat('Fast', 'Search')} />
          <ActionRow icon="analytics-outline" title="Analyze" description="Compare the trade-offs" onPress={() => handleNewChat('Auto', 'Analyze')} />
          <ActionRow icon="create-outline" title="Create" description="Find a starting point" onPress={() => handleNewChat('Auto', 'Create')} />
        </View>
      </ScrollView>
    </View>
  );
}

function ActionRow({ icon, title, description, onPress }: { icon: any, title: string, description: string, onPress: () => void }) {
  const { colors } = usePreferences();
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${description}`}
      style={[styles.actionRow, { borderBottomColor: colors.border }]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <View style={styles.actionRowText}>
        <ThemedText variant="body" weight="medium">{title}</ThemedText>
        <ThemedText variant="caption" color="secondary">{description}</ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: 100 },
  header: { marginBottom: Spacing.xl, marginTop: Spacing.md },
  subtitle: {
    marginTop: Spacing.xs,
  },
  mockInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.sm,
    paddingLeft: Spacing.md,
    borderRadius: Radii.full,
    borderWidth: 1,
    marginBottom: Spacing.xxl,
  },
  mockInputBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    letterSpacing: 1,
  },
  quickActions: {
    flexDirection: 'column',
    gap: 0,
  },
  activeSection: {
    marginBottom: Spacing.xl,
  },
  activeList: {
    flexDirection: 'column',
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  actionRowText: {
    flex: 1,
  },
});
