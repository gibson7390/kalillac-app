import React from 'react';
import { TouchableOpacity, StyleSheet, ActivityIndicator, ViewStyle, StyleProp } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { ThemedText } from './ThemedText';
import { Radii, Spacing } from '@/constants/Theme';
import * as Haptics from 'expo-haptics';

interface ButtonProps {
  onPress: () => void;
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
}

export function Button({
  onPress,
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  icon,
  accessibilityLabel,
}: ButtonProps) {
  const { colors, hapticsEnabled } = usePreferences();

  const handlePress = () => {
    if (disabled || loading) return;
    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  const getBgColor = () => {
    if (disabled && variant !== 'ghost') return colors.border;
    switch (variant) {
      case 'primary': return colors.text;
      case 'secondary': return colors.surfaceSecondary;
      case 'outline': return 'transparent';
      case 'danger': return colors.error;
      case 'ghost': return 'transparent';
    }
  };

  const getTextColor = () => {
    if (disabled && variant !== 'ghost') return colors.textTertiary;
    switch (variant) {
      case 'primary': return colors.background;
      case 'secondary': return colors.text;
      case 'outline': return colors.text;
      case 'danger': return '#FFFFFF';
      case 'ghost': return colors.textSecondary;
    }
  };

  const getBorderColor = () => {
    if (variant === 'outline') return colors.border;
    return 'transparent';
  };

  const getHeight = () => {
    switch (size) {
      case 'sm': return 36;
      case 'lg': return 56;
      case 'md':
      default: return 48;
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      style={[
        styles.base,
        {
          backgroundColor: getBgColor(),
          borderColor: getBorderColor(),
          borderWidth: variant === 'outline' ? 1 : 0,
          height: getHeight(),
          paddingHorizontal: size === 'sm' ? Spacing.md : Spacing.lg,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} />
      ) : (
        <>
          {icon}
          <ThemedText
            variant="button"
            style={{ color: getTextColor(), marginLeft: icon ? Spacing.sm : 0 }}
          >
            {title}
          </ThemedText>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.full,
  },
});
