import React from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useChatRepository, ChatSession } from '@/contexts/ChatRepositoryContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, Radii } from '@/constants/Theme';
import { router } from 'expo-router';

export default function SavedTab() {
  const { colors } = usePreferences();
  const insets = useSafeAreaInsets();
  const { savedSessions, deleteSavedSession, continueSavedSession } = useChatRepository();

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

  const handleDelete = (id: string) => {
    Alert.alert('Delete Saved Chat', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteSavedSession(id) }
    ]);
  };

  const renderItem = ({ item }: { item: ChatSession }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => handleOpen(item.id)}
      onLongPress={() => handleDelete(item.id)}
      style={[styles.item, { borderBottomColor: colors.border }]}
    >
      <View style={styles.itemContent}>
        <ThemedText variant="body" weight="medium" numberOfLines={1}>{item.title}</ThemedText>
        <ThemedText variant="caption" color="secondary" style={{ marginTop: 4 }}>
          {new Date(item.updatedAt).toLocaleDateString()} • {item.messages.length} messages
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText variant="h2">Saved Chats</ThemedText>
        <ThemedText variant="bodySm" color="secondary" style={{ marginTop: 4 }}>
          Memory-only saved state (V1 local persistence placeholder). Copies will vanish on app reload.
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
            <ThemedText variant="body" color="secondary" style={{ marginTop: Spacing.md }}>
              No saved chats yet.
            </ThemedText>
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
    padding: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemContent: { flex: 1, paddingRight: Spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
