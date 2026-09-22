import React from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useChatRepository,
  ChatSession,
  resolveLogicalConversationId,
} from '@/contexts/ChatRepositoryContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { Spacing, Radii } from '@/constants/Theme';
import { router } from 'expo-router';
import { Button } from '@/components/Button';

export default function SavedTab() {
  const { colors } = usePreferences();
  const insets = useSafeAreaInsets();
  const {
    activeSessions,
    savedSessions,
    deleteLogicalConversation,
    continueSavedSession,
    createSession,
  } = useChatRepository();

  const handleOpen = async (id: string) => {
    try {
      const activeId = await continueSavedSession(id);
      if (activeId) {
        router.push(`/chat/${activeId}`);
        return;
      }
    } catch {
      Alert.alert('Could not open snapshot', 'This memory copy is no longer available.');
    }
  };

  const handleDelete = (savedSessionId: string) => {
    const logicalConversationId = resolveLogicalConversationId(
      activeSessions,
      savedSessions,
      savedSessionId,
    );
    if (!logicalConversationId) return;

    const confirmDelete = () => deleteLogicalConversation(logicalConversationId);
    if (Platform.OS === 'web') {
      if (globalThis.confirm('Delete this conversation? This removes the saved copy and any active version of this chat. This cannot be undone.')) {
        confirmDelete();
      }
      return;
    }

    Alert.alert('Delete this conversation?', 'This removes the saved copy and any active version of this chat. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Conversation', style: 'destructive', onPress: confirmDelete }
    ]);
  };

  const handleStart = () => {
    const id = createSession();
    router.push(`/chat/${id}`);
  };

  const renderItem = ({ item }: { item: ChatSession }) => (
    <View style={[styles.item, { borderBottomColor: colors.border }]}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleOpen(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open saved chat: ${item.title}`}
        style={styles.itemTouch}
      >
        <View style={styles.itemContent}>
          <ThemedText variant="body" weight="medium" numberOfLines={1}>{item.title}</ThemedText>
          <ThemedText variant="caption" color="secondary" style={{ marginTop: 4 }}>
            Snapshot • {new Date(item.updatedAt).toLocaleDateString()} • {item.messages.length} messages
          </ThemedText>
        </View>
      </TouchableOpacity>
      <TouchableOpacity 
        style={styles.deleteBtn}
        onPress={() => handleDelete(item.id)}
        testID={`delete-saved-conversation-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel="Delete conversation"
      >
        <Ionicons name="trash-outline" size={20} color={colors.error} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText variant="h2">Saved Snapshots</ThemedText>
        <ThemedText variant="bodySm" color="secondary" style={{ marginTop: 4 }}>
          Memory-only state. Copies vanish on app reload. 
        </ThemedText>
      </View>

      <FlatList
        data={savedSessions}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, savedSessions.length === 0 && { flex: 1 }]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={48} color={colors.textTertiary} />
            <ThemedText variant="body" color="secondary" style={{ marginTop: Spacing.md, marginBottom: Spacing.xl }}>
              You haven't saved any snapshots yet.
            </ThemedText>
            <Button title="Start a conversation" onPress={handleStart} variant="secondary" />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: Spacing.lg, paddingBottom: Spacing.md },
  listContent: { paddingBottom: 100 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemTouch: {
    flex: 1,
    padding: Spacing.lg,
  },
  itemContent: { flex: 1, paddingRight: Spacing.md },
  deleteBtn: {
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
});
