import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { usePreferences } from '../contexts/PreferencesContext';
import { ThemedText } from './ThemedText';
import { chatErrorPresentation } from '../utils/chatErrorPresentation';
import type { ChatMessage } from '../contexts/ChatRepositoryContext';
import { Radii, Spacing } from '../constants/Theme';
import { AI_CONSENT_REQUIRED } from '../services/aiProcessingConsentState';

export function ResponseNotice({ message, disabled, onRetry, onReviewConsent }: {
  message: ChatMessage; disabled: boolean; onRetry: () => void; onReviewConsent?: () => void;
}) {
  const { colors } = usePreferences();
  const error = chatErrorPresentation(message.requestStatus, message.requestError);
  return (
    <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View accessibilityLiveRegion="polite">
        <ThemedText variant="bodySm" weight="semiBold">{error.title}</ThemedText>
        <ThemedText variant="bodySm" color="secondary" style={{ marginTop: 4 }}>{error.message}</ThemedText>
      </View>
      {message.requestError === AI_CONSENT_REQUIRED && onReviewConsent && (
        <TouchableOpacity onPress={onReviewConsent} accessibilityRole="button" accessibilityLabel="Review AI processing"
          style={styles.retry} activeOpacity={0.7}>
          <ThemedText variant="bodySm" weight="semiBold" style={{ color: colors.accent }}>Review AI processing</ThemedText>
        </TouchableOpacity>
      )}
      {error.retry && (
        <TouchableOpacity onPress={onRetry} disabled={disabled} accessibilityRole="button"
          accessibilityLabel={message.requestStatus === 'cancelled' ? 'Try stopped response again' : 'Retry failed response'}
          accessibilityState={{ disabled }} activeOpacity={0.7}
          style={[styles.retry, { opacity: disabled ? 0.4 : 1 }]}>
          <ThemedText variant="bodySm" weight="semiBold" style={{ color: colors.accent }}>Try again</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  notice: { padding: Spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.md, marginTop: Spacing.sm },
  retry: { minHeight: 44, paddingHorizontal: Spacing.sm, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 4 },
});
