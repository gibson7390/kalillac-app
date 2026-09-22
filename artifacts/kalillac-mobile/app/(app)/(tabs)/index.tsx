import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, Radii } from '@/constants/Theme';
import { router } from 'expo-router';
import { useChatRepository, AIModelMode } from '@/contexts/ChatRepositoryContext';

export default function HomeTab() {
  const { colors } = usePreferences();
  const insets = useSafeAreaInsets();
  const { createSession, clearAllTemporary } = useChatRepository();

  const handleNewChat = (mode: AIModelMode = 'Auto', task?: string) => {
    clearAllTemporary();
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
          <ThemedText variant="h1">Good Morning.</ThemedText>
          <ThemedText variant="body" color="secondary">What would you like to explore?</ThemedText>
        </View>

        <View style={styles.quickActions}>
          <ActionCard
            icon="search-outline"
            title="Research"
            description="Deep dive with citations"
            onPress={() => handleNewChat('Auto', 'Research')}
          />
          <ActionCard
            icon="code-slash-outline"
            title="Code"
            description="Explore a code example"
            onPress={() => handleNewChat('Auto', 'Code')}
          />
          <ActionCard
            icon="book-outline"
            title="Study"
            description="Explain complex topics"
            onPress={() => handleNewChat('Auto', 'Study')}
          />
          <ActionCard
            icon="flash-outline"
            title="Search"
            description="Explore sample sources"
            onPress={() => handleNewChat('Fast', 'Search')}
          />
          <ActionCard icon="analytics-outline" title="Analyze" description="Compare the trade-offs" onPress={() => handleNewChat('Auto', 'Analyze')} />
          <ActionCard icon="create-outline" title="Create" description="Find a starting point" onPress={() => handleNewChat('Auto', 'Create')} />
        </View>

        <TouchableOpacity 
          style={[styles.newChatBtn, { backgroundColor: colors.text }]}
          onPress={() => handleNewChat('Auto')}
          accessibilityRole="button"
          accessibilityLabel="New Conversation"
        >
          <Ionicons name="add" size={24} color={colors.background} />
          <ThemedText variant="button" style={{ color: colors.background, marginLeft: Spacing.sm }}>
            New Conversation
          </ThemedText>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function ActionCard({ icon, title, description, onPress }: { icon: any, title: string, description: string, onPress: () => void }) {
  const { colors } = usePreferences();
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${description}`}
      style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <ThemedText variant="body" weight="medium" style={{ marginTop: Spacing.md, marginBottom: 4 }}>{title}</ThemedText>
      <ThemedText variant="caption" color="secondary">{description}</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: 100 },
  header: { marginBottom: Spacing.xl, marginTop: Spacing.md },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  card: {
    width: '47%',
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center'
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radii.full,
  },
});
