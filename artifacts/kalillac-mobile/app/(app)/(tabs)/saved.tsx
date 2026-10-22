import React, { useCallback, useRef, useState } from 'react';
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
import { Spacing, Radii, Controls } from '@/constants/Theme';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '@/components/Button';
import * as Haptics from 'expo-haptics';

export default function SavedTab() {
  const { colors, hapticsEnabled } = usePreferences();
  const insets = useSafeAreaInsets();
  const {
    activeSessions,
    savedSessions,
    savedLoaded,
    savedLoadError,
    deleteLogicalConversation,
    continueSavedSession,
    createSession,
  } = useChatRepository();

  const openingRef = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    openingRef.current = false;
    setOpeningId(null);
  }, []));

  const handleOpen = async (id: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningId(id);
    try {
      if (hapticsEnabled) Haptics.selectionAsync();
      const activeId = await continueSavedSession(id);
      if (activeId) {
        router.push(`/chat/${activeId}`);
        return;
      }
      openingRef.current = false;
      setOpeningId(null);
    } catch {
      openingRef.current = false;
      setOpeningId(null);
      Alert.alert('Could not open snapshot', 'This saved chat is unavailable or damaged. You can delete it or try again.');
    }
  };

  const handleDelete = (savedSessionId: string) => {
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const logicalConversationId = resolveLogicalConversationId(
      activeSessions,
      savedSessions,
      savedSessionId,
    );
    if (!logicalConversationId) return;

    const confirmDelete = async () => {
      try {
        await deleteLogicalConversation(logicalConversationId);
      } catch {
        Alert.alert('Could not delete', 'The local saved record could not be removed. Please try again.');
      }
    };
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
    if (openingRef.current) return;
    openingRef.current = true;
    if (hapticsEnabled) Haptics.selectionAsync();
    const id = createSession();
    router.push(`/chat/${id}`);
  };

  const renderItem = ({ item, index }: { item: ChatSession, index: number }) => (
    <View style={[styles.item, index !== savedSessions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleOpen(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open saved chat: ${item.title}`}
        accessibilityState={{ busy: openingId === item.id, disabled: openingId !== null }}
        disabled={openingId !== null}
        style={[styles.itemTouch, openingId !== null && openingId !== item.id && { opacity: 0.5 }]}
      >
        <View style={[styles.iconBox, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="bookmark-outline" size={16} color={colors.textSecondary} />
        </View>
        <View style={styles.itemContent}>
          <ThemedText variant="body" weight="medium" numberOfLines={1}>{item.title}</ThemedText>
          <ThemedText variant="caption" color="secondary" style={{ marginTop: 2 }}>
            {openingId === item.id
              ? 'Restoring…'
              : `Snapshot · ${new Date(item.updatedAt).toLocaleDateString()} · ${item.messages.length} ${item.messages.length === 1 ? 'message' : 'messages'}`}
          </ThemedText>
        </View>
      </TouchableOpacity>
      <TouchableOpacity 
        style={styles.deleteBtn}
        onPress={() => handleDelete(item.id)}
        testID={`delete-saved-conversation-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Delete saved chat: ${item.title}`}
      >
        <Ionicons name="trash-outline" size={20} color={colors.error} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText variant="h2" weight="semiBold">Saved Snapshots</ThemedText>
        <ThemedText variant="bodySm" color="secondary" style={{ marginTop: 4 }}>
          {Platform.OS === 'web'
            ? 'Browser preview: saved copies last only until reload.'
            : 'Encrypted snapshots saved on this device.'}
        </ThemedText>
      </View>

      <FlatList
        data={savedLoaded && !savedLoadError ? savedSessions : []}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: Spacing.lg, paddingBottom: Math.max(insets.bottom + 20, 100) }, savedSessions.length === 0 && { flex: 1, paddingHorizontal: 0 }]}
        ListEmptyComponent={
          <View style={styles.empty} accessibilityLiveRegion="polite">
            <Ionicons
              name={savedLoadError ? 'alert-circle-outline' : !savedLoaded ? 'hourglass-outline' : 'bookmark-outline'}
              size={44}
              color={savedLoadError ? colors.error : colors.textTertiary}
            />
            <ThemedText variant="body" weight="semiBold" align="center" accessibilityRole="header" style={{ marginTop: Spacing.md }}>
              {savedLoadError ? 'Saved chats unavailable' : !savedLoaded ? 'Loading saved chats…' : 'No saved chats yet'}
            </ThemedText>
            <ThemedText variant="bodySm" color="secondary" align="center" style={{ marginTop: Spacing.xs, marginBottom: Spacing.lg, lineHeight: 20 }}>
              {savedLoadError
                ? 'Saved chats could not be read on this device. Restart the app to try again. Temporary chats still work.'
                : !savedLoaded
                  ? Platform.OS === 'web' ? 'Reading this browser preview’s snapshots.' : 'Reading encrypted snapshots on this device.'
                  : 'Chats stay temporary until you choose Save. In a chat, tap Save to keep a snapshot here.'}
            </ThemedText>
            {savedLoaded && (
              <Button title="Start a temporary chat" onPress={handleStart} variant="secondary" accessibilityLabel="Start a temporary chat" />
            )}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: Spacing.lg, paddingBottom: Spacing.md },
  listContent: { },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    minHeight: Controls.minTarget + Spacing.md,
  },
  itemTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  itemContent: { flex: 1, paddingRight: Spacing.md },
  deleteBtn: {
    minWidth: Controls.minTarget,
    minHeight: Controls.minTarget,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
});
