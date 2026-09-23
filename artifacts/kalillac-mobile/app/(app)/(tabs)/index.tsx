import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { Spacing, Radii } from '@/constants/Theme';
import { router } from 'expo-router';
import { useChatRepository, AIModelMode, meaningfulActiveSessions } from '@/contexts/ChatRepositoryContext';
import { BrandLockup } from '@/components/BrandLockup';
import * as Haptics from 'expo-haptics';

export default function HomeTab() {
  const { colors, hapticsEnabled } = usePreferences();
  const insets = useSafeAreaInsets();
  const { createSession, activeSessions } = useChatRepository();
  const resumableSessions = meaningfulActiveSessions(activeSessions);

  const handleNewChat = (mode: AIModelMode = 'Auto', task?: string) => {
    if (hapticsEnabled) Haptics.selectionAsync();
    const id = createSession(mode);
    if (task) {
      router.push({ pathname: `/chat/${id}`, params: { task } } as any);
    } else {
      router.push(`/chat/${id}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 20, 100) }]}>
        <View style={styles.header}>
          <BrandLockup compact />
          <ThemedText variant="bodySm" color="secondary" style={styles.subtitle}>Your private workspace</ThemedText>
        </View>

        <TouchableOpacity 
          activeOpacity={0.8}
          style={[styles.mockInput, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => handleNewChat('Auto')}
          accessibilityRole="button"
          accessibilityLabel="Start a new conversation"
        >
          <ThemedText variant="body" color="tertiary">Ask Kalillac anything...</ThemedText>
          <View style={[styles.mockInputBtn, { backgroundColor: colors.accent }]}>
            <Ionicons name="arrow-up" size={18} color={colors.textBubbleUser} />
          </View>
        </TouchableOpacity>

        {resumableSessions.length > 0 && (
          <View style={styles.activeSection}>
            <ThemedText variant="caption" weight="semiBold" color="secondary" style={styles.sectionTitle}>
              ACTIVE CHATS
            </ThemedText>
            <View style={[styles.cardGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {resumableSessions.map((activeSession, index) => (
                <TouchableOpacity
                  key={activeSession.id}
                  activeOpacity={0.7}
                  style={[
                    styles.activeRow,
                    index !== resumableSessions.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }
                  ]}
                  onPress={() => {
                    if (hapticsEnabled) Haptics.selectionAsync();
                    router.push(`/chat/${activeSession.id}`)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Resume ${activeSession.title}`}
                >
                  <View style={[styles.iconBox, { backgroundColor: colors.surfaceSecondary }]}>
                    <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
                  </View>
                  <View style={styles.actionRowText}>
                    <ThemedText variant="body" weight="medium" numberOfLines={1}>
                      {activeSession.title}
                    </ThemedText>
                    <ThemedText variant="caption" color="secondary">
                      Temporary · {activeSession.messages.length} {activeSession.messages.length === 1 ? 'message' : 'messages'}
                    </ThemedText>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <ThemedText variant="caption" weight="semiBold" color="secondary" style={styles.sectionTitle}>
          START WITH A TASK
        </ThemedText>

        <View style={[styles.cardGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActionRow icon="search-outline" title="Research" description="Deep dive with citations" onPress={() => handleNewChat('Auto', 'Research')} />
          <ActionRow icon="code-slash-outline" title="Code" description="Explore a code example" onPress={() => handleNewChat('Auto', 'Code')} />
          <ActionRow icon="book-outline" title="Study" description="Explain complex topics" onPress={() => handleNewChat('Auto', 'Study')} />
          <ActionRow icon="flash-outline" title="Search" description="Explore sample sources" onPress={() => handleNewChat('Fast', 'Search')} />
          <ActionRow icon="analytics-outline" title="Analyze" description="Compare the trade-offs" onPress={() => handleNewChat('Auto', 'Analyze')} />
          <ActionRow icon="create-outline" title="Create" description="Find a starting point" onPress={() => handleNewChat('Auto', 'Create')} isLast />
        </View>
      </ScrollView>
    </View>
  );
}

function ActionRow({ icon, title, description, onPress, isLast }: { icon: any, title: string, description: string, onPress: () => void, isLast?: boolean }) {
  const { colors, hapticsEnabled } = usePreferences();
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        if (hapticsEnabled) Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${description}`}
      style={[
        styles.actionRow,
        !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.actionRowText}>
        <ThemedText variant="body" weight="medium">{title}</ThemedText>
        <ThemedText variant="caption" color="secondary">{description}</ThemedText>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: Spacing.lg },
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    letterSpacing: 0.5,
  },
  cardGroup: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
  },
  activeSection: {
    marginBottom: Spacing.md,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  actionRowText: {
    flex: 1,
  },
});
