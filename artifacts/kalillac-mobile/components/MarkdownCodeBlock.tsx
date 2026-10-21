import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from './ThemedText';
import { Spacing, Radii } from '../constants/Theme';
import { logAssistantDiagnostic } from '../utils/assistantRenderDiagnostics';

interface Props {
  content: string;
  backgroundColor: string;
  color: string;
  messageId?: string;
  codeBlockKey?: string;
  codeBlockIndex?: number;
}

/**
 * A horizontal viewport, not a second vertical scroller.
 * Override ScrollView's native flexGrow/flexShrink defaults: the message cell
 * must own its intrinsic height, even when it exceeds the chat viewport.
 * No guessed/maximum heights or line truncation; the parent list owns vertical travel.
 */
export function MarkdownCodeBlock({
  content,
  backgroundColor,
  color,
  messageId,
  codeBlockKey,
  codeBlockIndex,
}: Props) {
  useEffect(() => {
    if (!messageId) return;
    logAssistantDiagnostic('code-block-mounted', {
      assistantMessageId: messageId,
      codeBlockKey,
      codeBlockIndex,
      codeChars: content.length,
    });
    return () => logAssistantDiagnostic('code-block-unmounted', {
      assistantMessageId: messageId,
      codeBlockKey,
      codeBlockIndex,
      codeChars: content.length,
    });
  }, [messageId, codeBlockKey, codeBlockIndex]);

  return renderMarkdownCodeBlock({
    content,
    backgroundColor,
    color,
    messageId,
    codeBlockKey,
    codeBlockIndex,
  });
}

export function renderMarkdownCodeBlock({
  content,
  backgroundColor,
  color,
  messageId,
  codeBlockKey,
  codeBlockIndex,
}: Props) {
  return (
    <View testID="markdown-code-block" style={[styles.frame, { backgroundColor }]}>
      <ScrollView
        testID="markdown-code-scroll"
        horizontal
        scrollEnabled
        directionalLockEnabled
        nestedScrollEnabled
        alwaysBounceVertical={false}
        alwaysBounceHorizontal={false}
        bounces={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator={false}
        onLayout={event => {
          if (!messageId) return;
          logAssistantDiagnostic('code-block-layout', {
            assistantMessageId: messageId,
            codeBlockKey,
            codeBlockIndex,
            codeChars: content.length,
            width: Math.round(event.nativeEvent.layout.width),
            height: Math.round(event.nativeEvent.layout.height),
          });
        }}
        style={styles.viewport}
        contentContainerStyle={styles.content}
      >
        <ThemedText variant="bodySm" style={[styles.code, { color }]}>
          {content}
        </ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    minWidth: 0,
    borderRadius: Radii.md,
    marginVertical: Spacing.sm,
    overflow: 'hidden',
  },
  viewport: { width: '100%', flexGrow: 0, flexShrink: 0 },
  content: { padding: Spacing.md, alignItems: 'flex-start' },
  code: { fontFamily: 'monospace', lineHeight: 22, flexGrow: 0, flexShrink: 0 },
});
