import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync,
  AESKeySize,
} from 'expo-crypto';
import { SavedChatStore, type AuthenticatedCipher } from './savedChatStore.ts';
import { Buffer } from 'buffer';

const cipher: AuthenticatedCipher = {
  async generateKey() {
    const key = await AESEncryptionKey.generate(AESKeySize.AES256);
    return key.encoded('base64');
  },
  async encrypt(rawKey, plaintext, id) {
    const key = await AESEncryptionKey.import(rawKey, 'base64');
    const sealed = await aesEncryptAsync(Buffer.from(plaintext, 'utf8'), key, {
      nonce: { length: 12 },
      tagLength: 16,
      additionalData: Buffer.from(id, 'utf8'),
    });
    return sealed.combined('base64');
  },
  async decrypt(rawKey, sealedText, id) {
    const key = await AESEncryptionKey.import(rawKey, 'base64');
    const sealed = AESSealedData.fromCombined(sealedText, { ivLength: 12, tagLength: 16 });
    return Buffer.from(await aesDecryptAsync(sealed, key, {
      additionalData: Buffer.from(id, 'utf8'),
    })).toString('utf8');
  },
};

const keyOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const savedChatStore = new SavedChatStore(AsyncStorage, {
  getItem: name => SecureStore.getItemAsync(name, keyOptions),
  setItem: (name, value) => SecureStore.setItemAsync(name, value, keyOptions),
}, cipher);