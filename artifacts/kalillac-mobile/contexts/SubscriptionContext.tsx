import { createContext, useContext, useState, ReactNode } from 'react';

type SubscriptionStatus = 'free' | 'plus';

interface SubscriptionState {
  status: SubscriptionStatus;
  allowanceUsed: number;
  allowanceTotal: number;
  purchasePlus: () => Promise<void>;
  cancelPlus: () => Promise<void>;
  restorePurchases: () => Promise<void>;
  consumeAllowance: (amount: number) => boolean;
}

const SubscriptionContext = createContext<SubscriptionState | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SubscriptionStatus>('free');
  const [allowanceUsed, setAllowanceUsed] = useState(0);
  const allowanceTotal = 1000; // Mock budget units

  const purchasePlus = async () => {
    // Mock purchase flow
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        setStatus('plus');
        setAllowanceUsed(0);
        resolve();
      }, 1500);
    });
  };

  const cancelPlus = async () => {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        setStatus('free');
        resolve();
      }, 500);
    });
  };

  const restorePurchases = async () => {
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        setStatus('plus');
        resolve();
      }, 1000);
    });
  };

  const consumeAllowance = (amount: number) => {
    if (status !== 'plus') return false;
    if (allowanceUsed + amount > allowanceTotal) return false;
    setAllowanceUsed((prev) => prev + amount);
    return true;
  };

  return (
    <SubscriptionContext.Provider
      value={{
        status,
        allowanceUsed,
        allowanceTotal,
        purchasePlus,
        cancelPlus,
        restorePurchases,
        consumeAllowance,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
