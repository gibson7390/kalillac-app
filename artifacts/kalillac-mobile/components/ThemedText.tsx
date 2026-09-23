import { Text, TextProps } from 'react-native';
import { usePreferences } from '@/contexts/PreferencesContext';
import { Typography } from '@/constants/Theme';

interface ThemedTextProps extends TextProps {
  variant?: 'display' | 'h1' | 'h2' | 'body' | 'bodySm' | 'caption' | 'button';
  color?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'error' | 'success' | 'inverse';
  weight?: 'regular' | 'medium' | 'semiBold' | 'bold';
  align?: 'left' | 'center' | 'right';
}

export function ThemedText({
  style,
  variant = 'body',
  color = 'primary',
  weight,
  align = 'left',
  ...rest
}: ThemedTextProps) {
  const { colors } = usePreferences();

  const getFontSize = () => {
    switch (variant) {
      case 'display': return Typography.sizes.display;
      case 'h1': return Typography.sizes.xxl;
      case 'h2': return Typography.sizes.xl;
      case 'button': return Typography.sizes.base;
      case 'bodySm': return Typography.sizes.sm;
      case 'caption': return Typography.sizes.xs;
      case 'body':
      default: return Typography.sizes.base;
    }
  };

  const getFontFamily = () => {
    if (weight) return Typography.fontFamily[weight];
    switch (variant) {
      case 'display': return Typography.fontFamily.semiBold;
      case 'h1': return Typography.fontFamily.semiBold;
      case 'h2': return Typography.fontFamily.medium;
      case 'button': return Typography.fontFamily.medium;
      default: return Typography.fontFamily.regular;
    }
  };

  const getTextColor = () => {
    switch (color) {
      case 'secondary': return colors.textSecondary;
      case 'tertiary': return colors.textTertiary;
      case 'accent': return colors.accent;
      case 'error': return colors.error;
      case 'success': return colors.success;
      case 'inverse': return colors.surface;
      case 'primary':
      default: return colors.text;
    }
  };

  const getLineHeight = () => {
    switch (variant) {
      case 'display': return Typography.sizes.display * 1.2;
      case 'h1': return Typography.sizes.xxl * 1.2;
      case 'h2': return Typography.sizes.xl * 1.3;
      case 'body': return Typography.sizes.base * 1.5;
      case 'bodySm': return Typography.sizes.sm * 1.5;
      case 'caption': return Typography.sizes.xs * 1.4;
      case 'button': return Typography.sizes.base * 1.2;
      default: return Typography.sizes.base * 1.5;
    }
  };

  return (
    <Text
      style={[
        {
          fontSize: getFontSize(),
          fontFamily: getFontFamily(),
          color: getTextColor(),
          textAlign: align,
          lineHeight: getLineHeight(),
        },
        style,
      ]}
      {...rest}
    />
  );
}
