/**
 * LaunchScreen
 *
 * Gate component that decides what to show when the app is locked:
 * - PIN configured → PinLockScreen (then auto-restore FEK from .fek_safe)
 * - No PIN → VaultPasswordLock (password re-inits hybridCrypto)
 * - Not locked → pass through (children)
 */

import React from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { PinLockScreen } from './PinLockScreen';
import { VaultPasswordLock } from './VaultPasswordLock';

interface LaunchScreenProps {
  children: React.ReactNode;
}

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ children }) => {
  const { isLocked, localProfile } = useSelector((state: RootState) => state.auth);

  if (!isLocked) {
    return <>{children}</>;
  }

  // Locked with PIN → PinLockScreen
  // After PIN unlock, FEK is restored automatically by tryRestoreFEKFromSafeStorage()
  // which is called in App.tsx on mount — it checks if _fek is null and .fek_safe exists
  if (localProfile?.hasPin) {
    return <PinLockScreen />;
  }

  // Locked without PIN → need vault password to re-derive FEK
  return <VaultPasswordLock />;
};

export default LaunchScreen;
