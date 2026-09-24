import { Platform } from 'react-native';
import type { SavedChatStore } from './savedChatStore';

// The web path is intentionally volatile and does not emulate iOS Keychain persistence.
export const savedChatStore: SavedChatStore = Platform.OS === 'web'
  ? require('./savedChatStore.web').savedChatStore
  : require('./savedChatStore.native').savedChatStore;