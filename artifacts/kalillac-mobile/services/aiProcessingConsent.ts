import AsyncStorage from '@react-native-async-storage/async-storage';
import { AIProcessingConsentStore } from './aiProcessingConsentState';

/** Shared by UI and the real network transport, not derived from UI preferences. */
export const aiProcessingConsent = new AIProcessingConsentStore(AsyncStorage);
