import React from 'react';
import { View, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useChatRepository } from '@/contexts/ChatRepositoryContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { Spacing, Radii } from '@/constants/Theme';
import { router } from 'expo-router';

export default function SettingsTab() {
  const { colors, themeMode, setThemeMode, hapticsEnabled, setHapticsEnabled, reduceMotion, setReduceMotion, offlineMode, setOfflineMode, apiErrorMode, setApiErrorMode } = usePreferences();
  const { status } = useSubscription();
  const { clearAllTemporary, corruptRandomSession, savedSessions } = useChatRepository();
  const insets = useSafeAreaInsets();

  const handleClearTemp = () => {
    Alert.alert('Clear Temporary Chats', 'This will erase all active temporary sessions from memory.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearAllTemporary }
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 20, 100) }]}>
        <ThemedText variant="h2" weight="semiBold" style={styles.header}>Settings</ThemedText>

        {__DEV__ && (
          <View style={styles.section}>
            <TouchableOpacity activeOpacity={0.7} style={[styles.row, styles.firstRow, styles.lastRow, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]} onPress={() => router.push('/paywall')}>
              <View style={styles.rowIcon}><Ionicons name="star" size={20} color={colors.accent} /></View>
              <View style={{ flex: 1 }}>
                <ThemedText variant="body" weight="medium">Kalillac Plus</ThemedText>
                <ThemedText variant="caption" color="secondary">
                  {status === 'plus' ? 'Active Subscription' : 'Upgrade for advanced models (Demo)'}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <ThemedText variant="caption" weight="semiBold" color="secondary" style={styles.sectionTitle}>PREFERENCES</ThemedText>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.row, styles.firstRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
              <ThemedText variant="body">Dark Mode</ThemedText>
              <Switch 
                value={themeMode === 'dark'} 
                onValueChange={(val) => setThemeMode(val ? 'dark' : 'light')} 
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Dark mode"
              />
            </View>
            <View style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
              <ThemedText variant="body">Haptics</ThemedText>
              <Switch 
                value={hapticsEnabled} 
                onValueChange={setHapticsEnabled} 
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Haptics"
              />
            </View>
            <View style={[styles.row, styles.lastRow]}>
              <ThemedText variant="body">Reduce Motion</ThemedText>
              <Switch 
                value={reduceMotion} 
                onValueChange={setReduceMotion} 
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Reduce motion"
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText variant="caption" weight="semiBold" color="secondary" style={styles.sectionTitle}>PRIVACY & DATA</ThemedText>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity activeOpacity={0.7} style={[styles.row, styles.firstRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]} onPress={() => router.push('/privacy')}>
              <ThemedText variant="body">Privacy Policy</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]} onPress={() => router.push('/providers')}>
              <ThemedText variant="body">AI Providers</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} style={[styles.row, styles.lastRow]} onPress={handleClearTemp}>
              <ThemedText variant="body" color="error">Clear Temporary Chats</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        {__DEV__ && (
          <View style={styles.section}>
            <ThemedText variant="caption" weight="semiBold" color="secondary" style={styles.sectionTitle}>DEVELOPER / DEMO</ThemedText>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.row, styles.firstRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <ThemedText variant="body">Simulate Offline Mode</ThemedText>
                <Switch 
                  value={offlineMode} 
                  onValueChange={setOfflineMode} 
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel="Simulate offline mode"
                />
              </View>
              <View style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <ThemedText variant="body">Simulate API Errors</ThemedText>
                <Switch 
                  value={apiErrorMode} 
                  onValueChange={setApiErrorMode} 
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel="Simulate API errors"
                />
              </View>
              <TouchableOpacity activeOpacity={0.7} style={[styles.row, styles.lastRow]} onPress={() => {
                if (savedSessions.length === 0) {
                  Alert.alert('No Saved Chats', 'Create a saved chat first to test corruption.');
                  return;
                }
                corruptRandomSession();
                Alert.alert('Simulated', 'The most recent saved chat state is randomly corrupted. Opening it will show an error.');
              }}>
                <ThemedText variant="body" color="error">Simulate Saved Chat Corruption</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.lg },
  header: { marginBottom: Spacing.lg },
  section: { marginBottom: Spacing.xl },
  sectionTitle: { marginBottom: Spacing.sm, marginLeft: Spacing.sm, letterSpacing: 0.5 },
  group: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  firstRow: { borderTopLeftRadius: Radii.lg, borderTopRightRadius: Radii.lg },
  lastRow: { borderBottomLeftRadius: Radii.lg, borderBottomRightRadius: Radii.lg },
  rowIcon: { width: 32, alignItems: 'flex-start' },
});
