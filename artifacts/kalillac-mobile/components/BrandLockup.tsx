import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Spacing } from '@/constants/Theme';

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Kalillac AI"
      style={[styles.row, compact && styles.compactRow]}
    >
      <ThemedText
        variant={compact ? 'h2' : 'h1'}
        weight="semiBold"
        style={styles.word}
      >
        Kalillac
      </ThemedText>
      <ThemedText
        variant={compact ? 'h2' : 'h1'}
        weight="bold"
        color="accent"
      >
        AI
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
  },
  compactRow: {
    gap: 2,
  },
  word: {
    letterSpacing: -0.5,
  },
});