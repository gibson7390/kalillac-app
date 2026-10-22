import type { AIModelMode } from '../contexts/ChatRepositoryContext';

export const MODE_DESCRIPTIONS: Record<AIModelMode, string> = {
  Auto: 'Kalillac chooses',
  Fast: 'Quick answers',
  Smart: 'Balanced reasoning',
  Deep: 'More thorough',
};
