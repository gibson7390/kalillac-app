import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, StyleSheet, FlatList, TextInput, TouchableOpacity, 
  Platform, ActivityIndicator, Alert, Share,
  Linking, ScrollView, useWindowDimensions
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useChatRepository,
  ChatMessage,
  AIModelMode,
  cancelledRequestUpdates,
  hasSavedSnapshotAssociation,
} from '@/contexts/ChatRepositoryContext';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { Spacing, Radii } from '@/constants/Theme';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Markdown, { ASTNode } from '@ronradtke/react-native-markdown-display';
import { generateId } from '@/utils/uuid';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSubscription } from '@/contexts/SubscriptionContext';

import { BackendChatError, KalillacChatService } from '@/services/KalillacChatService';
import type { ChatTransportMessage, ChatTransport } from '@/services/chatTransport';
import { StreamTimingSession } from '@/services/streamTiming';

function toBackendMessages(
  messages: ChatMessage[],
  prompt?: string,
  appendPrompt = false,
): ChatTransportMessage[] {
  const normalized = messages
    .filter(message => message.content.trim())
    .map(message => ({
      role: message.role === 'ai' ? 'assistant' as const : 'user' as const,
      content: message.content.trim(),
    }));

  if (prompt?.trim() && (appendPrompt || normalized.at(-1)?.role !== 'user')) {
    normalized.push({ role: 'user', content: prompt.trim() });
  }

  return normalized.slice(-40);
}

function AssistantRenderCommitProbe({
  timing,
  content,
  isStreaming,
}: {
  timing?: StreamTimingSession;
  content: string;
  isStreaming: boolean;
}) {
  useEffect(() => {
    if (isStreaming && content.length > 0) timing?.assistantRenderCommitted();
  }, [timing, content, isStreaming]);
  return null;
}

export default function ChatScreen() {
  const { id, task } = useLocalSearchParams<{ id: string; task?: string }>();
  const { colors, offlineMode, apiErrorMode, hapticsEnabled } = usePreferences();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  
  const {
    getSession, addMessage, updateMessage, deleteMessageAndAfter, saveSession,
    updateSavedSession, deleteLogicalConversation, registerRequestCancellation,
    beginRequest, updateRequestState,
  } = useChatRepository();
  const { status, consumeAllowance } = useSubscription();
  const session = getSession(id || '');
  const hasSavedCopy = session ? hasSavedSnapshotAssociation(session) : false;
  const headerTitleMaxWidth = Math.max(96, Math.min(320, windowWidth - 184));

  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeMode, setActiveMode] = useState<AIModelMode>(session?.mode || 'Auto');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const chatServiceRef = useRef<ChatTransport | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const cancelledMessageIdsRef = useRef<Set<string>>(new Set());
  const streamGenerationRef = useRef(0);
  const streamTimingsRef = useRef(new Map<string, StreamTimingSession>());
  const inputRef = useRef<TextInput>(null);

  const cancelActiveRequest = useCallback((reason = 'cancelled') => {
    streamGenerationRef.current += 1;
    chatServiceRef.current?.stop();
    const activeMessageId = activeMessageIdRef.current;
    const sessionId = id || '';
    if (!activeMessageId || !sessionId) {
      setIsGenerating(false);
      return;
    }

    cancelledMessageIdsRef.current.add(activeMessageId);
    updateMessage(sessionId, activeMessageId, cancelledRequestUpdates(reason));
    updateRequestState(sessionId, {
      status: 'cancelled',
      messageId: activeMessageId,
      error: reason,
    });
    activeMessageIdRef.current = null;
    setIsGenerating(false);
  }, [id, updateMessage, updateRequestState]);

  useEffect(() => {
    return () => {
      cancelActiveRequest('unmounted');
    };
  }, [cancelActiveRequest]);

  useEffect(() => {
    if (!session) return;
    return registerRequestCancellation(session.id, () => cancelActiveRequest('conversation-deleted'));
  }, [session?.id, registerRequestCancellation, cancelActiveRequest]);

  if (!session) return null;

  if (session.corrupted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ title: 'Error', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
        <Ionicons name="warning" size={64} color={colors.error} />
        <ThemedText variant="h2" style={{ marginTop: Spacing.md }}>Mock Payload Corrupted</ThemedText>
        <ThemedText variant="body" color="secondary" align="center" style={{ marginTop: Spacing.sm, paddingHorizontal: Spacing.lg }}>
          This saved chat snapshot cannot be read. The data payload may be corrupted.
        </ThemedText>
        <TouchableOpacity style={{ marginTop: Spacing.xl, padding: Spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: Radii.md }} onPress={() => router.back()}>
          <ThemedText variant="button">Go Back</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  const runStream = async (
    sessionId: string,
    aiMessageId: string,
    backendMessages: ChatTransportMessage[],
  ) => {
    if (cancelledMessageIdsRef.current.has(aiMessageId)) return;
    updateMessage(sessionId, aiMessageId, { requestStatus: 'streaming', requestError: undefined });
    updateRequestState(sessionId, { status: 'streaming', messageId: aiMessageId });
    if (offlineMode) {
      updateMessage(sessionId, aiMessageId, { content: '', isStreaming: false, requestStatus: 'offline', requestError: 'offline' });
      updateRequestState(sessionId, { status: 'offline', messageId: aiMessageId, error: 'offline' });
      activeMessageIdRef.current = null;
      setIsGenerating(false);
      return;
    }
    if (apiErrorMode) {
      updateMessage(sessionId, aiMessageId, { content: '', isStreaming: false, requestStatus: 'api-failure', requestError: 'api-failure' });
      updateRequestState(sessionId, { status: 'api-failure', messageId: aiMessageId, error: 'api-failure' });
      activeMessageIdRef.current = null;
      setIsGenerating(false);
      return;
    }

    const streamGeneration = ++streamGenerationRef.current;
    const timing = __DEV__ ? new StreamTimingSession() : undefined;
    if (timing) streamTimingsRef.current.set(aiMessageId, timing);
    const service = new KalillacChatService(timing);
    chatServiceRef.current = service;
    let latestContent = '';
    const isCurrentStream = () => (
      streamGenerationRef.current === streamGeneration
      && activeMessageIdRef.current === aiMessageId
      && !cancelledMessageIdsRef.current.has(aiMessageId)
    );

    try {
      await service.streamResponse((chunk, isDone) => {
        if (!isCurrentStream()) return;
        latestContent = chunk;
        if (!isDone) timing?.screenStreamingUpdate();
        updateMessage(sessionId, aiMessageId, {
          content: chunk,
          isStreaming: !isDone,
          requestStatus: isDone ? 'completed' : 'streaming',
        });
        if (isDone) {
          updateRequestState(sessionId, { status: 'completed', messageId: aiMessageId });
          activeMessageIdRef.current = null;
          setIsGenerating(false);
        }
      }, task, backendMessages, activeMode);
    } catch (e) {
      if (!isCurrentStream()) return;
      updateMessage(sessionId, aiMessageId, {
        content: latestContent,
        isStreaming: false,
        requestStatus: 'api-failure',
        requestError: e instanceof BackendChatError ? e.code : 'backend-failure',
      });
      updateRequestState(sessionId, {
        status: 'api-failure',
        messageId: aiMessageId,
        error: e instanceof BackendChatError ? e.code : 'backend-failure',
      });
      activeMessageIdRef.current = null;
      setIsGenerating(false);
    } finally {
      if (isCurrentStream()) {
        chatServiceRef.current = null;
      }
    }
  };

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isGenerating) return;

    if (activeMode === 'Deep' || activeMode === 'Smart') {
       if (status !== 'plus' || !consumeAllowance(1)) {
          Alert.alert('Allowance Exhausted', 'Please upgrade or switch to Auto/Fast to continue.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Upgrade', onPress: () => router.push('/paywall') }
          ]);
          return;
       }
    }

    const userText = input.trim();
    if (!userText && attachments.length > 0) {
      Alert.alert('Attachments unavailable', 'File requests are not supported in this milestone.');
      return;
    }
    const backendMessages = toBackendMessages(session.messages, userText, true);
    setInput('');
    const currentAttachments = [...attachments];
    setAttachments([]);

    addMessage(session.id, { id: generateId(), role: 'user', content: userText, modeUsed: activeMode, attachments: currentAttachments });
    
    setIsGenerating(true);
    const aiMessageId = generateId();
    cancelledMessageIdsRef.current.delete(aiMessageId);
    activeMessageIdRef.current = aiMessageId;
    addMessage(session.id, {
      id: aiMessageId,
      role: 'ai',
      content: '',
      isStreaming: true,
      modeUsed: activeMode,
      requestStatus: 'streaming',
      requestPrompt: userText,
      retryCount: 0,
    });
    beginRequest(session.id, userText, aiMessageId);

    runStream(session.id, aiMessageId, backendMessages);

    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const handleStop = () => {
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    cancelActiveRequest();
  };

  const handleRetryMessage = (message: ChatMessage) => {
    if (isGenerating || !message.requestPrompt) return;
    if (hapticsEnabled) Haptics.selectionAsync();
    setIsGenerating(true);
    cancelledMessageIdsRef.current.delete(message.id);
    activeMessageIdRef.current = message.id;
    updateMessage(session.id, message.id, {
      content: '',
      isStreaming: true,
      requestStatus: 'retrying',
      requestError: undefined,
      retryCount: (message.retryCount ?? 0) + 1,
    });
    beginRequest(session.id, message.requestPrompt, message.id, true);
    runStream(session.id, message.id, toBackendMessages(session.messages, message.requestPrompt));
  };

  const handleRegenerate = () => {
    if (hapticsEnabled) Haptics.selectionAsync();
    handleStop();
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      const aiMsgsToDrop = session.messages.filter(m => m.role === 'ai' && session.messages.indexOf(m) > session.messages.indexOf(lastUserMsg));
      if (aiMsgsToDrop.length > 0) {
        deleteMessageAndAfter(session.id, aiMsgsToDrop[0].id);
      }
      
      setIsGenerating(true);
      const aiMessageId = generateId();
      cancelledMessageIdsRef.current.delete(aiMessageId);
      activeMessageIdRef.current = aiMessageId;
      addMessage(session.id, {
        id: aiMessageId,
        role: 'ai',
        content: '',
        isStreaming: true,
        modeUsed: activeMode,
        requestStatus: 'retrying',
        requestPrompt: lastUserMsg.content,
        retryCount: 1,
      });
      beginRequest(session.id, lastUserMsg.content, aiMessageId, true);
      
      runStream(session.id, aiMessageId, toBackendMessages(session.messages, lastUserMsg.content));
    }
  };

  const handleEdit = (msgId: string, content: string) => {
    if (hapticsEnabled) Haptics.selectionAsync();
    Alert.alert('Edit Message', 'Clear recent messages and resubmit this prompt?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resubmit', onPress: () => {
        handleStop();
        setInput(content);
        deleteMessageAndAfter(session.id, msgId);
        setTimeout(() => inputRef.current?.focus(), 100);
      }}
    ]);
  };

  const handleCopy = (text: string) => {
    Clipboard.setStringAsync(text);
    if (hapticsEnabled && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleShare = (text: string) => {
    if (hapticsEnabled) Haptics.selectionAsync();
    Share.share({ message: text });
  };

  const handleAttachMock = () => {
    Alert.alert('Demo attachment', 'Choose a fixture. No real file is read or uploaded.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Image', onPress: () => pushAttachment('image.jpg', 'image') },
      { text: 'PDF Document', onPress: () => pushAttachment('document.pdf', 'pdf') },
      { text: 'Test rejected file', onPress: () => Alert.alert('Attachment rejected', 'Demo: this file exceeds the 10 MB limit or has an unsupported type. Choose an image or PDF fixture instead.') }
    ]);
  };

  const pushAttachment = (name: string, type: 'image' | 'pdf' | 'doc') => {
    setAttachments(prev => [...prev, {
      id: generateId(),
      name: `${prev.length + 1}-${name}`,
      type,
      size: 1024 * 1024 * 2.5
    }]);
  }

  const removeAttachment = (id: string) => {
    if (hapticsEnabled) Haptics.selectionAsync();
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSave = async () => {
    if (saving || isGenerating) return;
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const performSave = async () => {
      setSaving(true);
      try {
        if (apiErrorMode) throw new Error('Simulated save failure');
        if (hasSavedCopy && session.savedCopyId) await updateSavedSession(session.id, session.savedCopyId);
        else await saveSession(session.id);
        Alert.alert('Snapshot saved', 'The detached memory copy changes only when you choose Update saved copy.');
      } catch {
        Alert.alert('Could not save', 'The mock repository is unavailable. Turn off simulated errors and retry.');
      } finally {
        setSaving(false);
      }
    };

    if (Platform.OS === 'web') {
      await performSave();
      return;
    }

    Alert.alert(hasSavedCopy ? 'Update saved copy' : 'Save this chat',
      'Save on this iPhone is a memory-only demo here. Copies disappear on reload and are not encrypted. Attachments and their metadata are excluded.',
      [{ text: 'Cancel', style: 'cancel' }, {
        text: hasSavedCopy ? 'Update saved copy' : 'Save on this iPhone',
        onPress: performSave,
      }]);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const requestStatus = item.requestStatus;
    const isFailed = requestStatus === 'offline' || requestStatus === 'api-failure' || requestStatus === 'cancelled';

    if (isFailed && !isUser && !item.content.trim()) {
      return (
        <View style={[styles.msgWrapper, styles.msgAi]}>
          <View style={[styles.msgBubble, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.error }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm }}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <ThemedText variant="body" weight="semiBold" style={{ marginLeft: 8, color: colors.error }}>
                {requestStatus === 'offline' ? 'Offline' : requestStatus === 'cancelled' ? 'Response stopped' : 'Connection failed'}
              </ThemedText>
            </View>
            <ThemedText variant="bodySm" color="secondary" style={{ marginBottom: Spacing.md }}>
              {requestStatus === 'offline'
                ? 'You appear to be offline. Check your connection and try again.'
                : requestStatus === 'cancelled'
                  ? 'Generation was stopped. Your prompt is preserved.'
                  : 'The Kalillac mock server did not respond.'}
            </ThemedText>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => handleRetryMessage(item)}
              style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.surfaceSecondary, borderRadius: Radii.full }}
              accessibilityRole="button"
              accessibilityLabel="Retry failed response"
            >
              <ThemedText variant="bodySm" weight="medium">Retry</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const markdownRules = {
      image: () => <ThemedText variant="caption" color="error">[Remote Image Blocked]</ThemedText>,
      html_block: () => <></>,
      html_inline: () => <></>,
      fence: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        const content = node.content || '';
        return (
          <View key={node.key} style={{ backgroundColor: isUser ? 'rgba(255,255,255,0.15)' : colors.surfaceSecondary, borderRadius: Radii.md, marginVertical: Spacing.sm, overflow: 'hidden' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.md }}>
              <ThemedText variant="bodySm" style={{ color: isUser ? colors.textBubbleUser : colors.text, fontFamily: 'monospace', lineHeight: 22 }}>
                {content}
              </ThemedText>
            </ScrollView>
          </View>
        );
      },
      code_block: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        const content = node.content || '';
        return (
          <View key={node.key} style={{ backgroundColor: isUser ? 'rgba(255,255,255,0.15)' : colors.surfaceSecondary, borderRadius: Radii.md, marginVertical: Spacing.sm, overflow: 'hidden' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.md }}>
              <ThemedText variant="bodySm" style={{ color: isUser ? colors.textBubbleUser : colors.text, fontFamily: 'monospace', lineHeight: 22 }}>
                {content}
              </ThemedText>
            </ScrollView>
          </View>
        );
      },
      table: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        return (
          <View key={node.key} style={{ width: '100%', marginVertical: Spacing.sm, borderColor: isUser ? 'rgba(255,255,255,0.3)' : colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.md, overflow: 'hidden' }}>
             <ScrollView
               horizontal
               showsHorizontalScrollIndicator={false}
               style={{ width: '100%' }}
               contentContainerStyle={{ paddingRight: Spacing.sm }}
             >
               <View style={{ flexDirection: 'column', alignSelf: 'flex-start' }}>
                 {children}
               </View>
             </ScrollView>
          </View>
        );
      },
      tr: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        return (
          <View key={node.key} style={{ flexDirection: 'row', alignSelf: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isUser ? 'rgba(255,255,255,0.3)' : colors.border }}>
            {children}
          </View>
        );
      },
      th: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        return (
          <View key={node.key} style={{ paddingVertical: 10, paddingHorizontal: Spacing.md, backgroundColor: isUser ? 'rgba(255,255,255,0.15)' : colors.surfaceSecondary, minWidth: 112, justifyContent: 'center' }}>
             <ThemedText weight="semiBold" variant="bodySm" style={{ color: isUser ? colors.textBubbleUser : colors.text }}>{children}</ThemedText>
          </View>
        );
      },
      td: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        return (
          <View key={node.key} style={{ paddingVertical: 10, paddingHorizontal: Spacing.md, minWidth: 112, justifyContent: 'center' }}>
             <ThemedText variant="bodySm" style={{ color: isUser ? colors.textBubbleUser : colors.text }}>{children}</ThemedText>
          </View>
        );
      },
    };

    return (
      <View style={[styles.msgWrapper, isUser ? styles.msgUser : styles.msgAi]}>
        <View style={[
          styles.msgBubble,
          isUser
            ? { backgroundColor: colors.bubbleUser, borderBottomRightRadius: 4 }
            : styles.msgAiBubble
        ]}>
          {!isUser && (
            <AssistantRenderCommitProbe
              timing={streamTimingsRef.current.get(item.id)}
              content={item.content}
              isStreaming={!!item.isStreaming}
            />
          )}
          {item.attachments && item.attachments.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: item.content ? 8 : 0 }}>
              {item.attachments.map(att => (
                <View key={att.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : colors.surfaceSecondary, padding: 4, paddingHorizontal: 8, borderRadius: Radii.sm }}>
                  <Ionicons name="document-text" size={14} color={isUser ? colors.textBubbleUser : colors.textBubbleAi} />
                  <ThemedText variant="caption" style={{ color: isUser ? colors.textBubbleUser : colors.textBubbleAi, marginLeft: 4 }}>
                    {att.name}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
          {!!item.content && (
            <Markdown
              rules={markdownRules}
              style={{
                body: { color: isUser ? colors.textBubbleUser : colors.textBubbleAi, fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24 },
                paragraph: { marginBottom: 8, marginTop: 0 },
                strong: { fontFamily: 'Inter_600SemiBold', color: isUser ? colors.textBubbleUser : colors.textBubbleAi },
                em: { fontStyle: 'italic', color: isUser ? colors.textBubbleUser : colors.textBubbleAi },
                code_inline: { backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : colors.surfaceSecondary, color: isUser ? colors.textBubbleUser : colors.text, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, fontFamily: 'monospace', overflow: 'hidden' },
                blockquote: { borderLeftWidth: 3, borderLeftColor: isUser ? 'rgba(255,255,255,0.3)' : colors.border, paddingLeft: 12, opacity: 0.9, marginVertical: 8 },
                bullet_list: { marginBottom: 8 },
                ordered_list: { marginBottom: 8 },
                list_item: { marginBottom: 4 },
                hr: { backgroundColor: isUser ? 'rgba(255,255,255,0.3)' : colors.border, height: StyleSheet.hairlineWidth, marginVertical: 12 },
                link: { color: isUser ? colors.textBubbleUser : colors.accent, textDecorationLine: 'underline' },
                heading1: { fontFamily: 'Inter_600SemiBold', fontSize: 24, marginVertical: 12, color: isUser ? colors.textBubbleUser : colors.textBubbleAi },
                heading2: { fontFamily: 'Inter_600SemiBold', fontSize: 20, marginVertical: 10, color: isUser ? colors.textBubbleUser : colors.textBubbleAi },
                heading3: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginVertical: 8, color: isUser ? colors.textBubbleUser : colors.textBubbleAi },
              }}
              onLinkPress={(url) => {
                  if (/^https:\/\//i.test(url)) {
                     Alert.alert('Example source', `Illustrative source, not live research:\n${url}\n\nOpening it contacts that website.`, [
                       { text: 'Cancel', style: 'cancel' },
                       { text: 'Open website', onPress: () => { Linking.openURL(url).catch(() => Alert.alert('Unavailable', 'The website could not be opened.')); } }
                     ]);
                    return false;
                 }
                  return false;
              }}
            >
              {item.content + (item.isStreaming ? ' █' : '')}
            </Markdown>
          )}
        </View>
        
        {!isUser && !item.isStreaming && (
          <View style={styles.msgActions}>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleCopy(item.content)} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Copy message"
            >
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleShare(item.content)} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Share message"
            >
              <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={handleRegenerate} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Regenerate response"
            >
              <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        
        {isUser && !isGenerating && (
          <View style={[styles.msgActions, { alignSelf: 'flex-end', marginRight: 4 }]}>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleEdit(item.id, item.content)} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Edit message"
            >
              <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const handleEndChat = () => {
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const message = hasSavedCopy
      ? 'Delete this conversation? Its saved copy will also be deleted. This cannot be undone.'
      : 'Delete this conversation? This cannot be undone.';
    const confirmDelete = () => {
      setInput('');
      setAttachments([]);
      deleteLogicalConversation(session.id);
      router.replace('/(app)/(tabs)');
    };

    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) confirmDelete();
      return;
    }

    Alert.alert('Delete this conversation?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Conversation', style: 'destructive', onPress: confirmDelete }
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerShown: true,
          headerTitle: () => (
            <View style={[styles.headerTitleContainer, { maxWidth: headerTitleMaxWidth }]}>
              <ThemedText
                testID="conversation-header-title"
                variant="body"
                weight="semiBold"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.headerTitleText}
              >
                {session.title}
              </ThemedText>
            </View>
          ),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerRight: () => (
            <View
              testID="conversation-header-actions"
              style={styles.headerActions}
            >
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleSave}
                disabled={saving || isGenerating || session.messages.length === 0}
                style={styles.headerBtn}
                accessibilityRole="button"
                accessibilityLabel={hasSavedCopy ? 'Update saved copy' : 'Save this chat'}
                accessibilityState={{ disabled: saving || isGenerating || session.messages.length === 0 }}
              >
                {saving ? <ActivityIndicator size="small" /> : <Ionicons name={hasSavedCopy ? "save-outline" : "bookmark-outline"} size={22} color={colors.text} style={{ opacity: (isGenerating || session.messages.length === 0) ? 0.4 : 1 }} />}
              </TouchableOpacity>
              {session.isTemporary && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleEndChat}
                  style={styles.headerBtn}
                  testID="delete-conversation-button"
                  accessibilityRole="button"
                  accessibilityLabel="Delete conversation"
                >
                  <Ionicons name="trash-outline" size={22} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          ),
        }} 
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ThemedText variant="caption" color="secondary" align="center" style={{ paddingHorizontal: Spacing.md, paddingVertical: 12 }}>
          Temporary chat · {hasSavedCopy ? 'Saved copy updates only by choice' : 'Memory only'}
        </ThemedText>

        <FlatList
          data={[...session.messages].reverse()}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={session.messages.length === 0 ? styles.emptyListContent : styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListEmptyComponent={(
            <View style={[styles.emptyState, { transform: [{ scaleY: -1 }] }]}>
              <ThemedText variant="body" color="secondary" align="center">
                Start a {task?.toLowerCase() || 'new'} conversation.
              </ThemedText>
            </View>
          )}
        />

        <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          {/* Mode Selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeSelectorRow}>
            {['Auto', 'Fast', 'Smart', 'Deep'].map((mode) => (
              <TouchableOpacity 
                key={mode} 
                activeOpacity={0.7}
                onPress={() => {
                  if (hapticsEnabled) Haptics.selectionAsync();
                  setActiveMode(mode as AIModelMode);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: activeMode === mode }}
                accessibilityLabel={`${mode} mode`}
                style={[
                  styles.modeBtn, 
                  activeMode === mode ? { backgroundColor: colors.accent } : { backgroundColor: colors.surfaceSecondary }
                ]}
              >
                <ThemedText variant="bodySm" weight="medium" style={{ color: activeMode === mode ? colors.textBubbleUser : colors.textSecondary }}>
                  {mode}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={[styles.inputBox, { backgroundColor: colors.surface, borderColor: isInputFocused ? colors.accent : colors.border }]}>
            {attachments.length > 0 && (
              <View style={[styles.attachmentsPreview, { borderBottomColor: colors.border }]}>
                {attachments.map(att => (
                  <View key={att.id} style={[styles.attachmentChip, { backgroundColor: colors.surfaceSecondary }]}>
                    <Ionicons name="document-text" size={16} color={colors.accent} />
                    <TouchableOpacity activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Preview demo attachment" onPress={() => Alert.alert('Demo attachment preview', `${att.name}\n${att.type.toUpperCase()} · 2.5 MB\nSample fixture only. No real file is read, parsed or stored.`)}>
                      <ThemedText variant="caption" numberOfLines={1} style={{ maxWidth: 100, marginLeft: 4 }}>{att.name}</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.7} accessibilityLabel="Remove attachment" onPress={() => removeAttachment(att.id)} style={{ marginLeft: 4, padding: 8 }}>
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            
            <View style={styles.inputRow}>
              {__DEV__ && (
                <TouchableOpacity 
                  activeOpacity={0.7}
                  style={styles.attachBtn} 
                  onPress={handleAttachMock}
                  accessibilityLabel="Attach file"
                >
                  <Ionicons name="add-outline" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              
              <TextInput
                ref={inputRef}
                style={[
                  styles.input,
                  { color: colors.text, paddingLeft: __DEV__ ? 0 : Spacing.md },
                  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : undefined,
                ]}
                placeholder="Ask Kalillac..."
                placeholderTextColor={colors.textTertiary}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={2000}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                selectionColor={colors.accent}
              />
              
              {isGenerating ? (
                <TouchableOpacity 
                  activeOpacity={0.7}
                  style={styles.sendBtn} 
                  onPress={handleStop}
                  accessibilityLabel="Stop generating"
                >
                  <Ionicons name="stop-circle" size={28} color={colors.error} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  activeOpacity={0.7}
                  style={styles.sendBtn} 
                  onPress={handleSend} 
                  disabled={!input.trim() && attachments.length === 0}
                  accessibilityLabel="Send message"
                  accessibilityState={{ disabled: !input.trim() && attachments.length === 0 }}
                >
                  <View style={[styles.sendIconWrapper, { backgroundColor: (input.trim() || attachments.length > 0) ? colors.accent : colors.surfaceSecondary }]}>
                    <Ionicons name="arrow-up" size={18} color={(input.trim() || attachments.length > 0) ? colors.textBubbleUser : colors.textTertiary} />
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: Spacing.md, gap: Spacing.md },
  emptyListContent: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: Spacing.md },
  emptyState: { paddingBottom: Spacing.md },
  msgWrapper: { marginBottom: Spacing.md },
  msgUser: { alignSelf: 'flex-end', maxWidth: '88%' },
  msgAi: { alignSelf: 'flex-start', maxWidth: '100%' },
  msgBubble: { paddingHorizontal: Spacing.md, paddingVertical: 12, borderRadius: Radii.xl },
  msgAiBubble: { paddingHorizontal: 0, paddingVertical: 4, borderRadius: 0, backgroundColor: 'transparent' },
  msgActions: { flexDirection: 'row', gap: 4, marginTop: 6, marginLeft: 4 },
  actionBtn: { padding: 4, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitleContainer: { minWidth: 0, justifyContent: 'center' },
  headerTitleText: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.xs },
  headerBtn: { padding: Spacing.xs, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  inputContainer: { padding: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  modeSelectorRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  modeBtn: { paddingHorizontal: Spacing.md, minHeight: 44, justifyContent: 'center', borderRadius: Radii.full },
  inputBox: { borderRadius: Radii.xl, borderWidth: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 4 },
  attachmentsPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, padding: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  attachmentChip: { flexDirection: 'row', alignItems: 'center', padding: 4, paddingHorizontal: 8, borderRadius: Radii.sm },
  attachBtn: { padding: Spacing.sm, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingBottom: 10 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: 22 },
  sendBtn: { padding: Spacing.xs, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingBottom: 6 },
  sendIconWrapper: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
