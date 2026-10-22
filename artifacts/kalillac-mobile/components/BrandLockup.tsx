import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Palette } from '@/constants/Theme';
import { usePreferences } from '@/contexts/PreferencesContext';

const MARK = require('@/assets/brand/kalillac-mark-ui.png');

/**
 * Approved Kalillac K mark. Navy artwork is never recolored; on dark theme it
 * sits on a restrained light-neutral tile so it stays legible.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const { isDark } = usePreferences();
  const pad = Math.round(size * 0.14);
  return (
    <View
      accessible={false}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.24),
          padding: isDark ? pad : 0,
          backgroundColor: isDark ? Palette.light.surfaceSecondary : 'transparent',
        },
      ]}
    >
      <Image source={MARK} style={styles.img} resizeMode="contain" accessible={false} />
    </View>
  );
}

export function BrandLockup({
  compact = false,
  showMark = false,
}: {
  compact?: boolean;
  showMark?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Kalillac AI"
      style={[styles.row, compact && styles.compactRow]}
    >
      {showMark && <BrandMark size={compact ? 28 : 40} />}
      <View style={styles.words}>
        <ThemedText
          variant={compact ? 'h2' : 'display'}
          weight="semiBold"
          style={styles.word}
        >
          Kalillac
        </ThemedText>
        <ThemedText variant={compact ? 'h2' : 'display'} weight="bold" color="accent">
          AI
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  compactRow: { gap: 8 },
  words: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 1, flexWrap: 'wrap' },
  word: { letterSpacing: -0.5 },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
});
