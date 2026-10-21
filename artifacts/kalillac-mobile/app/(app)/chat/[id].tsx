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
import { MarkdownCodeBlock } from '@/components/MarkdownCodeBlock';
import {
  assistantRenderStats,
  logAssistantDiagnostic,
  type AssistantRenderState,
} from '@/utils/assistantRenderDiagnostics';
import { NATIVE_CANDIDATE_ID } from '@/dev/nativeCandidate';
import { savedChatStore } from '@/services/savedChatAdapter';
import { markdownForDisplayWithInfo } from '@/utils/streamingMarkdown';
import { regenerationPlan, startRegeneration } from '@/utils/regeneration';
import { nativeDiagnostics } from '@/dev/nativeDiagnostics';
import { customerVisibleAssistantText } from '@/utils/customerVisibleText';

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
  messageId,
  messageKey,
  content,
  state,
  deltaNumber,
  renderedCodeBlockCount,
  displayInfo,
}: {
  timing?: StreamTimingSession;
  messageId: string;
  messageKey: string;
  content: string;
  state: AssistantRenderState;
  deltaNumber: number;
  renderedCodeBlockCount: { current: number };
  displayInfo: ReturnType<typeof markdownForDisplayWithInfo>;
}) {
  const previousKey = useRef(messageKey);
  const latestContent = useRef(content);
  const latestState = useRef(state);
  latestContent.current = content;
  latestState.current = state;

  useEffect(() => {
    logAssistantDiagnostic('message-mounted', {
      assistantMessageId: messageId,
      messageKey,
      state: latestState.current,
      accumulatedChars: latestContent.current.length,
    });
    return () => logAssistantDiagnostic('message-unmounted', {
      assistantMessageId: messageId,
      messageKey,
      state: latestState.current,
      accumulatedChars: latestContent.current.length,
    });
  }, [messageId, messageKey]);

  useEffect(() => {
    logAssistantDiagnostic('message-key-observed', {
      assistantMessageId: messageId,
      messageKey,
      messageKeyChanged: previousKey.current !== messageKey,
    });
    previousKey.current = messageKey;
    const stats = assistantRenderStats(
      content,
      deltaNumber,
      state,
      renderedCodeBlockCount.current,
      displayInfo,
    );
    logAssistantDiagnostic('message-render-committed', {
      assistantMessageId: messageId,
      messageKey,
      ...stats,
    });
    if (state === 'streaming' && content.length > 0) timing?.assistantRenderCommitted();
  }, [timing, messageId, messageKey, content, state, deltaNumber, renderedCodeBlockCount, displayInfo]);

  return null;
}

export default function ChatScreen() {
  const { id, task, fixture } = useLocalSearchParams<{ id: string; task?: string; fixture?: string }>();
  const { colors, offlineMode, apiErrorMode, hapticsEnabled } = usePreferences();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  
  const {
    getSession, addMessage, updateMessage, deleteMessageAndAfter, saveSession,
    updateSavedSession, deleteLogicalConversation, registerRequestCancellation,
    savedLoaded, savedLoadError,
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
  const assistantDeltaCountsRef = useRef(new Map<string, number>());
  const assistantReceivedContentRef = useRef(new Map<string, string>());
  const messageKeysRef = useRef(new Map<string, string>());
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (__DEV__ && Platform.OS === 'ios') {
      logAssistantDiagnostic('candidate-loaded', { candidateId: NATIVE_CANDIDATE_ID });
    }
  }, [id]);

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
    const content = assistantReceivedContentRef.current.get(activeMessageId) ?? '';
    const deltaNumber = assistantDeltaCountsRef.current.get(activeMessageId) ?? 0;
    logAssistantDiagnostic('message-stopped', {
      assistantMessageId: activeMessageId,
      ...assistantRenderStats(content, deltaNumber, 'stopped'),
    });
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
    regenerating = false,
  ) => {
    if (cancelledMessageIdsRef.current.has(aiMessageId)) return;
    updateMessage(sessionId, aiMessageId, {
      requestStatus: 'streaming',
      requestError: undefined,
      sources: undefined,
    });
    updateRequestState(sessionId, { status: 'streaming', messageId: aiMessageId });
    if (offlineMode) {
      if (regenerating) logAssistantDiagnostic('regenerate_failed', { assistantMessageId: aiMessageId, errorClass: 'OfflineError' });
      updateMessage(sessionId, aiMessageId, { content: '', isStreaming: false, requestStatus: 'offline', requestError: 'offline' });
      updateRequestState(sessionId, { status: 'offline', messageId: aiMessageId, error: 'offline' });
      activeMessageIdRef.current = null;
      setIsGenerating(false);
      return;
    }
    if (apiErrorMode) {
      if (regenerating) logAssistantDiagnostic('regenerate_failed', { assistantMessageId: aiMessageId, errorClass: 'SimulatedBackendError' });
      updateMessage(sessionId, aiMessageId, { content: '', isStreaming: false, requestStatus: 'api-failure', requestError: 'api-failure' });
      updateRequestState(sessionId, { status: 'api-failure', messageId: aiMessageId, error: 'api-failure' });
      activeMessageIdRef.current = null;
      setIsGenerating(false);
      return;
    }

    const streamGeneration = ++streamGenerationRef.current;
    const timing = __DEV__ ? new StreamTimingSession() : undefined;
    if (timing) streamTimingsRef.current.set(aiMessageId, timing);
    const fixtures = __DEV__
      ? require('@/dev/chatFixtures') as typeof import('@/dev/chatFixtures')
      : undefined;
    const localFixture = fixtures?.resolveChatFixture(fixture)
      ?? fixtures?.fixtureForMessages(session.messages);
    const service: ChatTransport = localFixture
      ? new (require('@/dev/chatFixtures') as typeof import('@/dev/chatFixtures')).FixtureChatService(localFixture)
      : new KalillacChatService(timing, requestId => {
        if (regenerating) logAssistantDiagnostic('regenerate_backend_request_started', { assistantMessageId: aiMessageId, requestId });
      });
    chatServiceRef.current = service;
    let latestContent = '';
    let deltaNumber = 0;
    if (regenerating) logAssistantDiagnostic('regenerate_transport_started', { assistantMessageId: aiMessageId });
    const isCurrentStream = () => (
      streamGenerationRef.current === streamGeneration
      && activeMessageIdRef.current === aiMessageId
      && !cancelledMessageIdsRef.current.has(aiMessageId)
    );

    try {
      await service.streamResponse((chunk, isDone) => {
        if (!isCurrentStream()) return;
        deltaNumber += 1;
        if (regenerating && deltaNumber === 1) {
          logAssistantDiagnostic('regenerate_first_delta', { assistantMessageId: aiMessageId });
        }
        assistantDeltaCountsRef.current.set(aiMessageId, deltaNumber);
        const previousContent = latestContent;
        latestContent = chunk;
        assistantReceivedContentRef.current.set(aiMessageId, chunk);
        logAssistantDiagnostic('message-state-update-requested', {
          assistantMessageId: aiMessageId,
          accumulatedChars: chunk.length,
          deltaNumber,
          state: isDone ? 'finalized' : 'streaming',
          ...(isDone ? { finalizationPreservedPrevious: chunk === previousContent } : {}),
        });
        if (!isDone) timing?.screenStreamingUpdate();
        updateMessage(sessionId, aiMessageId, {
          content: chunk,
          isStreaming: !isDone,
          requestStatus: isDone ? 'completed' : 'streaming',
        });
        if (isDone) {
          if (regenerating) logAssistantDiagnostic('regenerate_completed', { assistantMessageId: aiMessageId });
          updateRequestState(sessionId, { status: 'completed', messageId: aiMessageId });
          activeMessageIdRef.current = null;
          setIsGenerating(false);
        }
      }, task, backendMessages, activeMode, sources => {
        if (!isCurrentStream()) return;
        updateMessage(sessionId, aiMessageId, { sources });
      });
    } catch (e) {
      if (!isCurrentStream()) return;
      if (regenerating) logAssistantDiagnostic('regenerate_failed', {
        assistantMessageId: aiMessageId, errorClass: e instanceof Error ? e.name : 'UnknownError',
      });
      logAssistantDiagnostic('message-stream-failed', {
        assistantMessageId: aiMessageId,
        ...assistantRenderStats(latestContent, deltaNumber, 'failed'),
        errorClass: e instanceof Error ? e.name : 'UnknownError',
      });
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
      if (chatServiceRef.current === service) {
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
    handleRegenerate(message);
  };

  const handleRegenerate = (message: ChatMessage) => {
    logAssistantDiagnostic('regenerate_pressed', { assistantMessageId: message.id });
    if (activeMessageIdRef.current) return;
    const plan = regenerationPlan(getSession(session.id)?.messages ?? session.messages, message.id);
    if (!plan) {
      logAssistantDiagnostic('regenerate_failed', { assistantMessageId: message.id, errorClass: 'MissingSourcePromptError' });
      Alert.alert('Could not retry', 'The original prompt is unavailable. Please send it again.');
      return;
    }
    logAssistantDiagnostic('regenerate_target_resolved', {
      assistantMessageId: message.id, sourceUserMessageId: plan.sourceUserMessageId,
    });
    if (hapticsEnabled) Haptics.selectionAsync();
    startRegeneration(plan, {
      cancelPrevious: () => cancelActiveRequest(),
      resetCancellation: targetId => cancelledMessageIdsRef.current.delete(targetId),
      activate: targetId => { activeMessageIdRef.current = targetId; setIsGenerating(true); },
      replaceAssistant: (targetId, patch) => updateMessage(session.id, targetId, { ...patch, modeUsed: activeMode }),
      beginRequest: (prompt, targetId) => beginRequest(session.id, prompt, targetId, true),
      run: (targetId, context) => {
        logAssistantDiagnostic('regenerate_request_started', {
          assistantMessageId: targetId, cancellationCleared: !cancelledMessageIdsRef.current.has(targetId),
        });
        void runStream(session.id, targetId, context, true);
      },
    });
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
    if (saving || isGenerating || !savedLoaded || savedLoadError) return;
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const operationId = session.id;
    const performSave = async () => {
      setSaving(true);
      try {
        if (apiErrorMode) throw new Error('Simulated save failure');
        if (hasSavedCopy && session.savedCopyId) await updateSavedSession(session.id, session.savedCopyId, operationId);
        else await saveSession(session.id, operationId);
        Alert.alert('Snapshot saved', Platform.OS === 'web'
          ? 'Browser preview: this copy disappears on reload. It changes only when you choose Update saved copy.'
          : 'Encrypted on this device. This copy changes only when you choose Update saved copy.');
      } catch (error) {
        savedChatStore.recordDiagnostic({
          operation: 'save',
          stage: 'save_failed',
          status: 'failure',
          operationId,
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        Alert.alert('Could not save', 'This saved copy could not be encrypted or stored. Please try again.');
      } finally {
        setSaving(false);
      }
    };

    if (Platform.OS === 'web') {
      savedChatStore.recordDiagnostic({
        operation: 'save', stage: 'save_confirmed', status: 'success', operationId,
      });
      await performSave();
      return;
    }

    Alert.alert(hasSavedCopy ? 'Update saved copy' : 'Save this chat',
      'Save an encrypted copy on this device. Later turns remain temporary until you choose Update saved copy. Attachments are excluded.',
      [{ text: 'Cancel', style: 'cancel' }, {
        text: hasSavedCopy ? 'Update saved copy' : 'Save on this iPhone',
        onPress: async () => {
          await savedChatStore.recordDiagnostic({
            operation: 'save', stage: 'save_confirmed', status: 'success', operationId,
          });
          await performSave();
        },
      }]);
  };

  const captureNativeEvidence = async () => {
    if (!__DEV__) return;
    const current = getSession(session.id);
    for (const message of current?.messages ?? []) {
      if (message.role !== 'ai') continue;
      const state: AssistantRenderState = message.isStreaming ? 'streaming'
        : message.requestStatus === 'cancelled' ? 'stopped'
          : message.requestStatus === 'api-failure' ? 'failed' : 'finalized';
      logAssistantDiagnostic('repository-state-captured', {
        assistantMessageId: message.id,
        ...assistantRenderStats(message.content, assistantDeltaCountsRef.current.get(message.id) ?? 0, state),
      });
    }
    try {
      await Clipboard.setStringAsync(await nativeDiagnostics.export());
      Alert.alert('Diagnostic trace copied', 'Only IDs, stages, counts, and layout measurements were copied. No chat text, ciphertext, or keys.');
    } catch {
      Alert.alert('Could not copy diagnostics', 'The content-free trace remains available in Settings. Please try copying again.');
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const requestStatus = item.requestStatus;
    const isFailed = requestStatus === 'offline' || requestStatus === 'api-failure' || requestStatus === 'cancelled';
    const currentSearchUnavailable = requestStatus === 'api-failure'
      && item.requestError === 'current-information-unavailable';
    const messageKey = item.id;
    const previousMessageKey = messageKeysRef.current.get(item.id);
    const messageKeyChanged = previousMessageKey !== undefined && previousMessageKey !== messageKey;
    messageKeysRef.current.set(item.id, messageKey);
    const renderState: AssistantRenderState = item.isStreaming
      ? 'streaming'
      : requestStatus === 'cancelled'
        ? 'stopped'
        : requestStatus === 'api-failure' || requestStatus === 'offline'
          ? 'failed'
          : 'finalized';
    const displayInfo = markdownForDisplayWithInfo(isUser ? item.content : customerVisibleAssistantText(item.content));

    if (isFailed && !isUser && !item.content.trim()) {
      return (
        <View style={[styles.msgWrapper, styles.msgAi]}>
          <View style={[styles.msgBubble, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.error }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm }}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <ThemedText variant="body" weight="semiBold" style={{ marginLeft: 8, color: colors.error }}>
                {requestStatus === 'offline' ? 'Offline'
                  : requestStatus === 'cancelled' ? 'Response stopped'
                    : currentSearchUnavailable ? 'Current info unavailable' : 'Connection failed'}
              </ThemedText>
            </View>
            <ThemedText variant="bodySm" color="secondary" style={{ marginBottom: Spacing.md }}>
              {requestStatus === 'offline'
                ? 'You appear to be offline. Check your connection and try again.'
                : requestStatus === 'cancelled'
                  ? 'Generation was stopped. Your prompt is preserved.'
                  : currentSearchUnavailable
                    ? 'Current web information is temporarily unavailable.'
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

    const renderedCodeBlockCount = { current: 0 };
    const markdownRules = {
      image: () => <ThemedText variant="caption" color="error">[Remote Image Blocked]</ThemedText>,
      html_block: () => <></>,
      html_inline: () => <></>,
      fence: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        const codeBlockIndex = ++renderedCodeBlockCount.current;
        return (
          <MarkdownCodeBlock
            key={node.key}
            content={node.content || ''}
            backgroundColor={isUser ? 'rgba(255,255,255,0.15)' : colors.surfaceSecondary}
            color={isUser ? colors.textBubbleUser : colors.text}
            messageId={item.id}
            codeBlockKey={String(node.key)}
            codeBlockIndex={codeBlockIndex}
          />
        );
      },
      code_block: (node: ASTNode, children: React.ReactNode[], parent: ASTNode[], styles: any) => {
        const codeBlockIndex = ++renderedCodeBlockCount.current;
        return (
          <MarkdownCodeBlock
            key={node.key}
            content={node.content || ''}
            backgroundColor={isUser ? 'rgba(255,255,255,0.15)' : colors.surfaceSecondary}
            color={isUser ? colors.textBubbleUser : colors.text}
            messageId={item.id}
            codeBlockKey={String(node.key)}
            codeBlockIndex={codeBlockIndex}
          />
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
        ]}
          onLayout={event => {
            if (isUser) return;
            logAssistantDiagnostic('message-layout', {
              assistantMessageId: item.id,
              messageKey,
              messageKeyChanged,
              accumulatedChars: item.content.length,
              height: Math.round(event.nativeEvent.layout.height),
              width: Math.round(event.nativeEvent.layout.width),
            });
          }}
        >
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
              {displayInfo.markdown
                ? `${displayInfo.markdown}${item.isStreaming ? ' █' : ''}`
                : ''}
            </Markdown>
          )}
          {!isUser && (
            <AssistantRenderCommitProbe
              timing={streamTimingsRef.current.get(item.id)}
              messageId={item.id}
              messageKey={messageKey}
              content={item.content}
              state={renderState}
              deltaNumber={assistantDeltaCountsRef.current.get(item.id) ?? 0}
              renderedCodeBlockCount={renderedCodeBlockCount}
              displayInfo={displayInfo}
            />
          )}
        </View>

        {!isUser && item.sources && item.sources.length > 0 && (
          <View style={styles.sourcesSection} testID={`message-sources-${item.id}`}>
            <ThemedText variant="caption" weight="semiBold" color="secondary" style={styles.sourcesHeading}>
              Sources
            </ThemedText>
            {item.sources.map((source, index) => (
              <TouchableOpacity
                key={source.id}
                activeOpacity={0.7}
                style={styles.sourceRow}
                accessibilityRole="link"
                accessibilityLabel={`Open source ${index + 1}: ${source.title}, ${source.domain}`}
                onPress={() => {
                  if (!/^https?:\/\//i.test(source.url)) return;
                  Linking.openURL(source.url).catch(() => {
                    Alert.alert('Unavailable', 'The source website could not be opened.');
                  });
                }}
              >
                <ThemedText variant="bodySm" weight="medium" style={{ color: colors.accent }}>
                  [{index + 1}] {source.title}
                </ThemedText>
                <ThemedText variant="caption" color="secondary" style={styles.sourceDomain}>
                  {source.domain}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        {!isUser && !item.isStreaming && (
          <View style={styles.msgActions}>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleCopy(customerVisibleAssistantText(item.content))}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Copy message"
            >
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleShare(customerVisibleAssistantText(item.content))}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Share message"
            >
              <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleRegenerate(item)}
              onPressIn={() => logAssistantDiagnostic('regenerate_touch_started', { assistantMessageId: item.id })}
              disabled={isGenerating}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Regenerate response"
              accessibilityState={{ disabled: isGenerating }}
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
    const confirmDelete = async () => {
      try {
        await deleteLogicalConversation(session.id);
        setInput('');
        setAttachments([]);
        router.replace('/(app)/(tabs)');
      } catch {
        Alert.alert('Could not delete', 'The local saved record could not be removed. Please try again.');
      }
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
                disabled={saving || isGenerating || session.messages.length === 0 || !savedLoaded || savedLoadError}
                style={styles.headerBtn}
                accessibilityRole="button"
                accessibilityLabel={hasSavedCopy ? 'Update saved copy' : 'Save this chat'}
                accessibilityState={{ disabled: saving || isGenerating || session.messages.length === 0 || !savedLoaded || savedLoadError }}
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
        {__DEV__ && Platform.OS === 'ios' && (
          <View>
          <ThemedText
            testID="dev-ios-candidate-marker"
            variant="caption"
            color="secondary"
            align="center"
          >
            iOS candidate: {NATIVE_CANDIDATE_ID}
          </ThemedText>
            <TouchableOpacity onPress={() => void captureNativeEvidence()} accessibilityRole="button"
              accessibilityLabel="Capture and copy native diagnostics" style={{ padding: 8 }}>
              <ThemedText variant="caption" align="center" color="secondary">Capture & copy native diagnostics</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          testID="chat-message-list"
          style={{ flex: 1 }}
          data={[...session.messages].reverse()}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          inverted
          removeClippedSubviews={false}
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
  msgAi: { alignSelf: 'flex-start', width: '100%', minWidth: 0 },
  msgBubble: { paddingHorizontal: Spacing.md, paddingVertical: 12, borderRadius: Radii.xl },
  msgAiBubble: { paddingHorizontal: 0, paddingVertical: 4, borderRadius: 0, backgroundColor: 'transparent' },
  msgActions: { flexDirection: 'row', gap: 4, marginTop: 6, marginLeft: 4 },
  sourcesSection: { marginTop: Spacing.sm, marginLeft: 4, maxWidth: '100%' },
  sourcesHeading: { marginBottom: 4 },
  sourceRow: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingVertical: 4, paddingRight: Spacing.md },
  sourceDomain: { marginTop: 1 },
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
