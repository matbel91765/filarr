/**
 * inviteLinkHygiene (F16) — les quatre règles du PORTEUR, éprouvées.
 *
 * Un lien d'invitation contient un jeton qui vaut l'accès : il est rendu une
 * seule fois par le serveur, et à partir de là c'est le client qui décide s'il
 * fuit. Les gardes que ces tests tiennent :
 *
 *  · UN JETON NE PART JAMAIS DANS UN FIL D'ARIANE. Sentry enregistre l'URL de
 *    chaque requête et de chaque navigation ; il suffit qu'un jour un lien
 *    d'invitation passe par l'un des deux pour qu'un porteur d'accès finisse
 *    dans un rapport de plantage. Le rédacteur coupe la VALEUR et garde la
 *    forme, sans quoi un rapport devient illisible pour rien.
 *
 *  · LE PRESSE-PAPIERS SE VIDE, MAIS SEULEMENT S'IL TIENT ENCORE LE LIEN.
 *    Écraser aveuglément le presse-papiers soixante secondes plus tard
 *    détruirait ce que la personne a copié entre-temps — un mot de passe, un
 *    paragraphe. On relit avant d'effacer, et un presse-papiers illisible
 *    (permission refusée) n'est PAS une raison d'écrire par-dessus.
 *
 *  · LE COMPTE À REBOURS NE MEURT PAS AVEC L'ÉCRAN. Copier puis fermer pour
 *    aller coller est le geste NORMAL : un minuteur attaché au cycle de vie du
 *    composant serait annulé là, et l'effacement promis n'aurait jamais lieu.
 *    Il vit donc dans le module, et seule une NOUVELLE copie — ou un
 *    verrouillage explicite — le remplace.
 *
 *   npx vitest run src/services/vault/__tests__/inviteLinkHygiene.vitest.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  INVITE_CLIPBOARD_TTL_MS,
  cancelPendingWipe,
  copyInviteLinkOnce,
  isInviteLink,
  scrubBreadcrumbLinks,
  scrubEventLinks,
  scrubInviteLinks,
} from '../inviteLinkHygiene';

describe('le rédacteur de jetons', () => {
  it('coupe le jeton d’une invitation de COFFRE et garde le reste lisible', () => {
    const url = 'https://app.filarr.com/vault-invite?token=abcdef123456&vault=v-1&org=o-1';
    const out = scrubInviteLinks(url);
    expect(out).not.toContain('abcdef123456');
    expect(out).toContain('vault-invite');
    expect(out).toContain('vault=v-1');
    expect(out).toContain('token=');
  });

  it('coupe le jeton d’une invitation d’ESPACE', () => {
    const out = scrubInviteLinks('https://app.filarr.com/invite?token=zzz-secret');
    expect(out).not.toContain('zzz-secret');
    expect(out).toContain('token=');
  });

  it('coupe aussi un jeton passé en FRAGMENT — l’autre forme envisagée', () => {
    const out = scrubInviteLinks('https://app.filarr.com/vault-invite#token=zzz-secret');
    expect(out).not.toContain('zzz-secret');
  });

  it('trouve le lien au MILIEU d’une phrase (un fil d’ariane est du texte libre)', () => {
    const out = scrubInviteLinks('clic sur https://app.filarr.com/invite?token=abc puis retour');
    expect(out).not.toContain('token=abc');
    expect(out).toContain('puis retour');
  });

  it('ne touche à rien d’autre — un rapport de plantage doit rester lisible', () => {
    const texte = 'GET https://api.filarr.com/vaults/v-1/members 200';
    expect(scrubInviteLinks(texte)).toBe(texte);
    // Un `token=` qui n'est pas un lien d'invitation ne regarde pas cette garde.
    expect(scrubInviteLinks('https://ailleurs.example/x?token=gardé')).toContain('gardé');
  });

  it('survit à ce qui n’est pas une chaîne', () => {
    expect(scrubInviteLinks(null)).toBeNull();
    expect(scrubInviteLinks(undefined)).toBeUndefined();
  });

  it('reconnaît un lien d’invitation, et seulement lui', () => {
    expect(isInviteLink('https://app.filarr.com/invite?token=a')).toBe(true);
    expect(isInviteLink('https://app.filarr.com/vault-invite?token=a&vault=v')).toBe(true);
    expect(isInviteLink('https://app.filarr.com/vaults/v-1')).toBe(false);
    expect(isInviteLink('')).toBe(false);
  });
});

describe('les deux crochets Sentry', () => {
  const lien = 'https://app.filarr.com/vault-invite?token=SECRET&vault=v-1';

  it('coupe le jeton d’un fil d’ariane de NAVIGATION (`history`)', () => {
    const b = { category: 'navigation', data: { from: lien, to: '/vaults' } };
    scrubBreadcrumbLinks(b);
    expect(JSON.stringify(b)).not.toContain('SECRET');
    // Le reste du fil survit : un fil d'ariane muet ne sert à rien.
    expect(b.data.to).toBe('/vaults');
    expect(b.data.from).toContain('vault=v-1');
  });

  it('coupe le jeton d’un fil d’ariane de REQUÊTE (`fetch`/`xhr`) et d’un message', () => {
    const b = { message: `ouverture de ${lien}`, data: { url: lien, status_code: 200 } };
    scrubBreadcrumbLinks(b);
    expect(JSON.stringify(b)).not.toContain('SECRET');
    expect(b.data.status_code).toBe(200);
  });

  it('survit à un fil d’ariane sans `data`, et à autre chose qu’un objet', () => {
    expect(() => scrubBreadcrumbLinks({ category: 'ui.click' })).not.toThrow();
    expect(() => scrubBreadcrumbLinks(null)).not.toThrow();
    expect(() => scrubBreadcrumbLinks('texte')).not.toThrow();
  });

  it('coupe le jeton dans l’URL de la page, le message et CHAQUE exception', () => {
    const e = {
      message: `échec sur ${lien}`,
      request: { url: lien },
      exception: { values: [{ value: `fetch ${lien} failed` }, { value: 'autre chose' }] },
    };
    scrubEventLinks(e);
    expect(JSON.stringify(e)).not.toContain('SECRET');
    expect(e.exception.values[1].value).toBe('autre chose');
  });

  it('survit à un événement dépouillé, et à autre chose qu’un objet', () => {
    expect(() => scrubEventLinks({})).not.toThrow();
    expect(() => scrubEventLinks({ exception: { values: 'pas un tableau' } })).not.toThrow();
    expect(() => scrubEventLinks(undefined)).not.toThrow();
  });

  /**
   * LES DEUX CHAMPS LIBRES. `extra` et `contexts` acceptent n'importe quel JSON :
   * un `captureException(e, { extra: { url } })` écrit un jour dans un coin y
   * ferait passer un porteur d'accès sans que personne s'en aperçoive. Ce sont
   * les seuls champs de l'événement où l'on ne peut pas nommer les clés à
   * l'avance — donc les seuls qu'il faut parcourir.
   */
  it('coupe le jeton dans `extra` et `contexts`, à toute profondeur', () => {
    const e = {
      extra: { url: lien, niveau: { liste: [lien, 'rien'] } },
      contexts: { invitation: { lien, count: 2 } },
    };
    scrubEventLinks(e);
    expect(JSON.stringify(e)).not.toContain('SECRET');
    // Le reste survit : un rapport dépouillé ne sert à rien.
    expect(e.extra.niveau.liste[1]).toBe('rien');
    expect(e.contexts.invitation.count).toBe(2);
  });

  it('ne se perd NI dans un cycle NI dans une structure sans fond', () => {
    const cycle: Record<string, unknown> = { url: lien };
    cycle.soi = cycle;
    expect(() => scrubEventLinks({ extra: cycle })).not.toThrow();
    expect(JSON.stringify(cycle.url)).not.toContain('SECRET');
  });
});

describe('le presse-papiers qui s’efface', () => {
  const lien = 'https://app.filarr.com/invite?token=abc';

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Le minuteur vit DANS LE MODULE : sans cette remise à zéro, celui d'un test
    // resterait armé pour le suivant.
    cancelPendingWipe();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const clipboardStub = (initial: string) => {
    let contenu = initial;
    return {
      writeText: vi.fn(async (v: string) => {
        contenu = v;
      }),
      readText: vi.fn(async () => contenu),
      get contenu() {
        return contenu;
      },
    };
  };

  it('écrit le lien, puis l’efface au bout d’une minute', async () => {
    const clip = clipboardStub('');
    vi.stubGlobal('navigator', { clipboard: clip });
    await copyInviteLinkOnce(lien);
    expect(clip.writeText).toHaveBeenCalledWith(lien);
    expect(clip.contenu).toBe(lien);

    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS + 10);
    expect(clip.contenu).toBe('');
  });

  it('N’ÉCRASE PAS ce que la personne a copié entre-temps', async () => {
    const clip = clipboardStub('');
    vi.stubGlobal('navigator', { clipboard: clip });
    await copyInviteLinkOnce(lien);
    await clip.writeText('mon mot de passe');

    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS + 10);
    expect(clip.contenu).toBe('mon mot de passe');
  });

  it('un presse-papiers ILLISIBLE n’autorise pas à écrire par-dessus', async () => {
    const clip = {
      writeText: vi.fn(async () => undefined),
      readText: vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    };
    vi.stubGlobal('navigator', { clipboard: clip });
    await copyInviteLinkOnce(lien);
    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS + 10);
    // Une seule écriture : celle de la copie. Jamais l'effacement à l'aveugle.
    expect(clip.writeText).toHaveBeenCalledTimes(1);
  });

  /**
   * LE GESTE NORMAL EST : copier, FERMER la ligne, aller coller dans sa
   * messagerie. Tant que la fonction rendait une poignée d'annulation, l'écran
   * l'appelait en se démontant — c'est-à-dire à chaque fermeture du dialogue,
   * chaque changement d'onglet, chaque clic sur « Masquer » — et le porteur
   * restait indéfiniment dans le presse-papiers PENDANT que la phrase
   * « Effacé du presse-papiers dans une minute environ. » était affichée.
   * Rien à annuler n'est donc rendu : le minuteur n'appartient plus à l'écran.
   */
  it('le compte à rebours SURVIT à l’écran : aucune poignée d’annulation n’est rendue', async () => {
    const clip = clipboardStub('');
    vi.stubGlobal('navigator', { clipboard: clip });
    const rendu: unknown = await copyInviteLinkOnce(lien);
    expect(rendu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS + 10);
    expect(clip.contenu).toBe('');
  });

  /**
   * « Copier à nouveau » ne doit pas laisser DEUX comptes à rebours en vol : le
   * premier effacerait la seconde copie trente secondes après qu'on l'a faite —
   * exactement pendant qu'on va coller.
   */
  it('une NOUVELLE copie REMPLACE le compte à rebours précédent', async () => {
    const clip = clipboardStub('');
    vi.stubGlobal('navigator', { clipboard: clip });
    await copyInviteLinkOnce(lien);
    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS / 2);
    await copyInviteLinkOnce(lien);

    // L'échéance du PREMIER passe : elle n'efface rien.
    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS / 2 + 10);
    expect(clip.contenu).toBe(lien);
    // Celle du SECOND, elle, va au bout.
    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS / 2);
    expect(clip.contenu).toBe('');
  });

  /**
   * La seule annulation qui reste légitime : on quitte le compte ou on
   * verrouille — plus personne n'est censé coller ce lien.
   */
  it('cancelPendingWipe (verrouillage, déconnexion) annule ce qui est en vol', async () => {
    const clip = clipboardStub('');
    vi.stubGlobal('navigator', { clipboard: clip });
    await copyInviteLinkOnce(lien);
    cancelPendingWipe();
    await vi.advanceTimersByTimeAsync(INVITE_CLIPBOARD_TTL_MS + 10);
    expect(clip.contenu).toBe(lien);
  });

  it('sans presse-papiers du tout, la copie ÉCHOUE au lieu de faire semblant', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyInviteLinkOnce(lien)).rejects.toThrow();
  });
});
