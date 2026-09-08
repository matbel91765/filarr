/**
 * DeviceLimitHost — monte l'écran « trop d'appareils » quand une connexion se
 * fait refuser, où qu'elle soit partie.
 *
 * La connexion part de cinq endroits (onboarding, réglages, écran de lancement,
 * inscription, migration). Cet hôte est monté UNE fois : c'est ce qui évite cinq
 * copies du même dialogue, dont quatre finiraient par diverger.
 */

import React, { useEffect, useState } from 'react';

import DeviceLimitDialog from './DeviceLimitDialog';
import {
  readDeviceLimitPrompt,
  subscribeDeviceLimitPrompt,
  publishDeviceLimitPrompt,
  type DeviceLimitPrompt,
} from '../../../services/auth/deviceLimitPrompt';

export const DeviceLimitHost: React.FC = () => {
  const [prompt, setPrompt] = useState<DeviceLimitPrompt | null>(() => readDeviceLimitPrompt());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeDeviceLimitPrompt(setPrompt), []);

  if (!prompt) return null;

  return (
    <DeviceLimitDialog
      isOpen
      cap={prompt.cap}
      sessions={prompt.sessions}
      busy={busy}
      onCancel={() => publishDeviceLimitPrompt(null)}
      onConfirm={async (deviceId) => {
        setBusy(true);
        try {
          await prompt.retry(deviceId);
          // La nouvelle tentative a soit abouti, soit republié un refus : dans
          // les deux cas ce dialogue-ci n'a plus lieu d'être.
          publishDeviceLimitPrompt(
            readDeviceLimitPrompt() === prompt ? null : readDeviceLimitPrompt()
          );
        } finally {
          setBusy(false);
        }
      }}
    />
  );
};

export default DeviceLimitHost;
