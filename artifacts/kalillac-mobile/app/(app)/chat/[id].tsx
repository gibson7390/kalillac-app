import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, StyleSheet, FlatList, TextInput, TouchableOpacity, 
  Platform, ActivityIndicator, Alert, Share,
  Image as RNImage, Linking, ScrollView
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useChatRepository,
  ChatMessage,
  AIModelMode,
  cancelledRequestUpdates,
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

import { MockChatService } from '@/services/MockChatService';

export default function ChatScreen() {
  const { id, task } = useLocalSearchParams<{ id: string; task?: string }>();
  const { colors, isDark, offlineMode, apiErrorMode, hapticsEnabled } = usePreferences();
  const insets = useSafeAreaInsets();
  
  const {
    getSession, addMessage, updateMessage, deleteMessageAndAfter, saveSession,
    updateSavedSession, endSession, beginRequest, updateRequestState,
  } = useChatRepository();
  const { status, consumeAllowance } = useSubscription();
  const session = getSession(id || '');

  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeMode, setActiveMode] = useState<AIModelMode>(session?.mode || 'Auto');
  const [showModes, setShowModes] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const chatServiceRef = useRef<MockChatService | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const cancelledMessageIdsRef = useRef<Set<string>>(new Set());

  const cancelActiveRequest = useCallback((reason = 'cancelled') => {
    const activeMessageId = activeMessageIdRef.current;
    const sessionId = id || '';
    if (!activeMessageId || !sessionId) return;

    cancelledMessageIdsRef.current.add(activeMessageId);
    chatServiceRef.current?.stop();
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

  const runStream = async (sessionId: string, aiMessageId: string) => {
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

    const service = new MockChatService();
    chatServiceRef.current = service;

    try {
      await service.streamResponse((chunk, isDone) => {
        if (cancelledMessageIdsRef.current.has(aiMessageId)) return;
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
      }, task);
    } catch (e) {
      if (cancelledMessageIdsRef.current.has(aiMessageId)) return;
      updateMessage(sessionId, aiMessageId, {
        content: '',
        isStreaming: false,
        requestStatus: 'api-failure',
        requestError: 'stream-interrupted',
      });
      updateRequestState(sessionId, { status: 'api-failure', messageId: aiMessageId, error: 'stream-interrupted' });
      activeMessageIdRef.current = null;
      setIsGenerating(false);
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
    setInput('');
    const currentAttachments = [...attachments];
    setAttachments([]);
    
    // Add User message
    addMessage(session.id, { id: generateId(), role: 'user', content: userText, modeUsed: activeMode, attachments: currentAttachments });
    
    // Setup AI Mock Streaming
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

    runStream(session.id, aiMessageId);
  };

  const handleStop = () => {
    cancelActiveRequest();
  };

  const handleRetryMessage = (message: ChatMessage) => {
    if (isGenerating || !message.requestPrompt) return;
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
    runStream(session.id, message.id);
  };

  const handleRegenerate = () => {
    handleStop();
    // Re-run the last user prompt
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      // Remove all messages after the last user message
      const aiMsgsToDrop = session.messages.filter(m => m.role === 'ai' && session.messages.indexOf(m) > session.messages.indexOf(lastUserMsg));
      if (aiMsgsToDrop.length > 0) {
        deleteMessageAndAfter(session.id, aiMsgsToDrop[0].id);
      }
      
      // Simulate generating again
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
      
      runStream(session.id, aiMessageId);
    }
  };

  const handleEdit = (msgId: string, content: string) => {
    Alert.alert('Edit Message', 'Clear recent messages and resubmit this prompt?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resubmit', onPress: () => {
        handleStop();
        // Set input and delete from this msg
        setInput(content);
        deleteMessageAndAfter(session.id, msgId);
      }}
    ]);
  };

  const handleCopy = (text: string) => {
    Clipboard.setStringAsync(text);
    if (hapticsEnabled && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleShare = (text: string) => {
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
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSave = async () => {
    if (saving || isGenerating) return;
    const performSave = async () => {
      setSaving(true);
      try {
        if (apiErrorMode) throw new Error('Simulated save failure');
        if (session.savedCopyId) await updateSavedSession(session.id, session.savedCopyId);
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

    Alert.alert(session.savedCopyId ? 'Update saved copy' : 'Save this chat',
      'Save on this iPhone is a memory-only demo here. Copies disappear on reload and are not encrypted. Attachments and their metadata are excluded.',
      [{ text: 'Cancel', style: 'cancel' }, {
        text: session.savedCopyId ? 'Update saved copy' : 'Save on this iPhone',
        onPress: performSave,
      }]);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const requestStatus = item.requestStatus;
    const isFailed = requestStatus === 'offline' || requestStatus === 'api-failure' || requestStatus === 'cancelled';

    if (isFailed && !isUser) {
      return (
        <View style={[styles.msgWrapper, styles.msgAi]}>
          <View style={[styles.msgBubble, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.error, padding: Spacing.md }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm }}>
              <Ionicons name="warning-outline" size={20} color={colors.error} />
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
        const lines = content.split('\n');
        return (
          <View key={node.key} style={{ backgroundColor: colors.surfaceSecondary, borderRadius: Radii.sm, marginTop: 4, marginBottom: 4, overflow: 'hidden' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.sm }}>
              <View>
                {lines.map((line, i) => {
                  const colored = line.split(/(\b(?:const|let|var|function|return|import|from|export|default|if|else|class)\b)/).map((segment, j) => {
                    if (['const','let','var','function','return','import','from','export','default','if','else','class'].includes(segment)) {
                        return <ThemedText key={j} variant="bodySm" style={{ color: '#C678DD', fontFamily: 'monospace' }}>{segment}</ThemedText>;
                    }
                    return <ThemedText key={j} variant="bodySm" style={{ color: colors.text, fontFamily: 'monospace' }}>{segment}</ThemedText>;
                  });
                  return <View key={i} style={{ flexDirection: 'row' }}>{colored}</View>;
                })}
              </View>
            </ScrollView>
          </View>
        );
      }
    };

    return (
      <View style={[styles.msgWrapper, isUser ? styles.msgUser : styles.msgAi]}>
        {!isUser && (
          <View style={[styles.aiAvatar, { backgroundColor: colors.surfaceSecondary }]}>
            <RNImage
              source={require('@/assets/brand/kalillac-mark.png')}
              style={styles.aiMark}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        )}
        <View style={[
          styles.msgBubble,
          isUser ? { backgroundColor: colors.bubbleUser } : { backgroundColor: colors.bubbleAi, borderWidth: 1, borderColor: colors.bubbleAiBorder }
        ]}>
          {item.attachments && item.attachments.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: item.content ? 8 : 0 }}>
              {item.attachments.map(att => (
                <View key={att.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : colors.surfaceSecondary, padding: 4, paddingHorizontal: 8, borderRadius: 4 }}>
                  <Ionicons name="document-text" size={12} color={isUser ? colors.textBubbleUser : colors.textBubbleAi} />
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
                paragraph: { marginBottom: 12 },
                strong: { fontFamily: 'Inter_600SemiBold' },
                em: { fontStyle: 'italic' },
                code_inline: { backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : colors.surfaceSecondary, color: isUser ? colors.textBubbleUser : colors.text, borderRadius: 4, paddingHorizontal: 4, fontFamily: 'monospace' },
                blockquote: { borderLeftWidth: 4, borderLeftColor: colors.border, paddingLeft: 12, opacity: 0.8 },
              }}
              onLinkPress={(url) => {
                  if (/^https:\/\//i.test(url)) {
                    // Open mock citation sheet
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
              onPress={() => handleCopy(item.content)} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Copy message"
            >
              <Ionicons name="copy-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => handleShare(item.content)} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Share message"
            >
              <Ionicons name="share-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={handleRegenerate} 
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Regenerate response"
            >
              <Ionicons name="refresh-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}
        
        {isUser && !isGenerating && (
          <View style={[styles.msgActions, { alignSelf: 'flex-end', marginRight: 4 }]}>
            <TouchableOpacity 
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
    Alert.alert('End Chat', 'This will delete the current temporary conversation from memory.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Chat', style: 'destructive', onPress: () => {
        handleStop(); // Cancel stream
         setInput('');
         setAttachments([]);
        endSession(session.id);
         router.replace('/(app)/(tabs)');
      }}
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerShown: true,
          title: session.title,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'center' }}>
              <TouchableOpacity onPress={handleSave} disabled={saving || isGenerating || session.messages.length === 0} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={session.savedCopyId ? 'Update saved copy' : 'Save this chat'}>
                {saving ? <ActivityIndicator /> : <Ionicons name={session.savedCopyId ? "save-outline" : "bookmark-outline"} size={24} color={colors.text} />}
              </TouchableOpacity>
              {session.isTemporary && (
                <TouchableOpacity onPress={handleEndChat} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="End chat">
                  <Ionicons name="trash-outline" size={24} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ),
        }} 
      />

      <ThemedText variant="caption" color="secondary" style={{ paddingHorizontal: Spacing.md, paddingVertical: 8 }}>
        Temporary chat · {session.savedCopyId ? 'Saved copy updates only by choice' : 'Memory only'}
      </ThemedText>
      <FlatList
        data={[...session.messages].reverse()}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        inverted
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListEmptyComponent={<ThemedText variant="body" color="secondary" style={{ transform: [{ scaleY: -1 }], padding: Spacing.lg }}>Start a {task?.toLowerCase() || 'new'} conversation.</ThemedText>}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom || Spacing.md }]}>
          
          {/* Mode Selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeSelectorRow}>
            {['Auto', 'Fast', 'Smart', 'Deep'].map((mode) => (
              <TouchableOpacity 
                key={mode} 
                onPress={() => setActiveMode(mode as AIModelMode)}
                accessibilityRole="button"
                accessibilityState={{ selected: activeMode === mode }}
                accessibilityLabel={`${mode} mode`}
                style={[
                  styles.modeBtn, 
                  activeMode === mode ? { backgroundColor: colors.text } : { backgroundColor: colors.surfaceSecondary }
                ]}
              >
                <ThemedText variant="bodySm" weight="medium" style={{ color: activeMode === mode ? colors.background : colors.textSecondary }}>
                  {mode}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={[styles.inputBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            {attachments.length > 0 && (
              <View style={styles.attachmentsPreview}>
                {attachments.map(att => (
                  <View key={att.id} style={[styles.attachmentChip, { backgroundColor: colors.surface }]}>
                    <Ionicons name="document-text" size={16} color={colors.accent} />
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Preview demo attachment" onPress={() => Alert.alert('Demo attachment preview', `${att.name}\n${att.type.toUpperCase()} · 2.5 MB\nSample fixture only. No real file is read, parsed or stored.`)}>
                      <ThemedText variant="caption" numberOfLines={1} style={{ maxWidth: 100, marginLeft: 4 }}>{att.name}</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityLabel="Remove attachment" onPress={() => removeAttachment(att.id)} style={{ marginLeft: 4, padding: 12 }}>
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            
            <View style={styles.inputRow}>
              {__DEV__ && (
                <TouchableOpacity 
                  style={styles.attachBtn} 
                  onPress={handleAttachMock}
                  accessibilityLabel="Attach file"
                >
                  <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Ask Kalillac..."
                placeholderTextColor={colors.textTertiary}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={2000}
              />
              
              {isGenerating ? (
                <TouchableOpacity 
                  style={styles.sendBtn} 
                  onPress={handleStop}
                  accessibilityLabel="Stop generating"
                >
                  <Ionicons name="stop-circle" size={28} color={colors.error} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  style={styles.sendBtn} 
                  onPress={handleSend} 
                  disabled={!input.trim() && attachments.length === 0}
                  accessibilityLabel="Send message"
                >
                  <Ionicons name="arrow-up-circle" size={28} color={(input.trim() || attachments.length > 0) ? colors.accent : colors.textTertiary} />
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
  msgWrapper: { marginBottom: Spacing.md, maxWidth: '85%' },
  msgUser: { alignSelf: 'flex-end' },
  msgAi: { alignSelf: 'flex-start', flexDirection: 'column' },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  aiMark: { width: 18, height: 18 },
  msgBubble: { padding: Spacing.md, borderRadius: Radii.lg },
  msgActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4, marginLeft: 4 },
  actionBtn: { padding: 4, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  inputContainer: { padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  modeSelectorRow: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.sm },
  modeBtn: { paddingHorizontal: Spacing.md, minHeight: 44, justifyContent: 'center', borderRadius: Radii.full },
  inputBox: { borderRadius: Radii.xl, borderWidth: 1, padding: Spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  attachmentsPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, padding: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.1)' },
  attachmentChip: { flexDirection: 'row', alignItems: 'center', padding: 4, paddingHorizontal: 8, borderRadius: Radii.sm },
  attachBtn: { padding: Spacing.sm, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, fontSize: 16 },
  sendBtn: { padding: Spacing.sm, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
