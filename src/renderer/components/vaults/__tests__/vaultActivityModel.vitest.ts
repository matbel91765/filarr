/**
 * Le modèle du fil d'activité — pur, sans React ni réseau.
 *
 * Ce qui se défend ici : le « vu » se compare en COUPLE (les égalités à la
 * milliseconde existent, le keyset serveur les départage par id — le badge
 * doit faire pareil) ; les clés i18n sont à UNDERSCORES (la paire
 * member.invite / member.invite.revoke rend la forme imbriquée impossible) ;
 * et le stockage du curseur survit à un environnement SANS localStorage
 * (vitest = node) comme à un JSON corrompu.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isNewer,
  unseenCount,
  unseenVaultIds,
  resolveActivityRow,
  unresolvedItemLabel,
  type ActivityRowContext,
} from '../vaultActivityModel';
import { getSeenCursor, setSeenCursor } from '../vaultActivitySeen';
import type { VaultActivityEventDTO } from '../../../../services/vault/vaultApi';
import en from '../../../../i18n/locales/en/translation.json';
import fr from '../../../../i18n/locales/fr/translation.json';

function evt(o: Partial<VaultActivityEventDTO> = {}): VaultActivityEventDTO {
  return {
    id: 10,
    actorUserId: 'user-alice-0001',
    eventType: 'member.item.update',
    targetId: 'vault1',
    occurredAt: 5000,
    metadata: { item_id: 'itemA', kind: 'meta' },
    ...o,
  };
}

function ctx(o: Partial<ActivityRowContext> = {}): ActivityRowContext {
  return {
    emailByUserId: new Map([['user-alice-0001', 'alice@x.com']]),
    nameByItemId: new Map([['itemA', 'rapport.pdf']]),
    ...o,
  };
}

describe('isNewer / unseenCount — le couple, jamais le temps seul', () => {
  it('à occurredAt ÉGAL, id départage', () => {
    const seen = { occurredAt: 5000, id: 10 };
    expect(isNewer({ occurredAt: 5000, id: 11 }, seen)).toBe(true);
    expect(isNewer({ occurredAt: 5000, id: 10 }, seen)).toBe(false);
    expect(isNewer({ occurredAt: 5000, id: 9 }, seen)).toBe(false);
    expect(isNewer({ occurredAt: 5001, id: 1 }, seen)).toBe(true);
  });

  it('jamais rien vu ⇒ tout est neuf ; le compte est borné à la page', () => {
    const page = [
      { occurredAt: 3000, id: 3 },
      { occurredAt: 2000, id: 2 },
      { occurredAt: 1000, id: 1 },
    ];
    expect(unseenCount(page, null)).toBe(3);
    expect(unseenCount(page, { occurredAt: 2000, id: 2 })).toBe(1);
  });
});

describe('resolveActivityRow', () => {
  it('member.item.update : metadata.kind choisit _meta vs _content', () => {
    expect(resolveActivityRow(evt(), ctx()).i18nKey).toBe(
      'teamVaults.activity.event.member_item_update_meta'
    );
    expect(
      resolveActivityRow(evt({ metadata: { item_id: 'itemA', kind: 'content' } }), ctx()).i18nKey
    ).toBe('teamVaults.activity.event.member_item_update_content');
  });

  it('les points deviennent des underscores — la paire invite/invite.revoke coexiste', () => {
    expect(resolveActivityRow(evt({ eventType: 'member.invite' }), ctx()).i18nKey).toBe(
      'teamVaults.activity.event.member_invite'
    );
    expect(resolveActivityRow(evt({ eventType: 'member.invite.revoke' }), ctx()).i18nKey).toBe(
      'teamVaults.activity.event.member_invite_revoke'
    );
  });

  it('item connu ⇒ nommé ; inconnu ⇒ unresolvedItemId, le fallback appartient au composant', () => {
    const connu = resolveActivityRow(evt(), ctx());
    expect(connu.params.item).toBe('rapport.pdf');
    expect(connu.unresolvedItemId).toBeNull();

    const inconnu = resolveActivityRow(
      evt({ metadata: { item_id: 'purge', kind: 'meta' } }),
      ctx()
    );
    expect(inconnu.params.item).toBeUndefined();
    expect(inconnu.unresolvedItemId).toBe('purge');
  });

  it('member.remove résout la personne RETIRÉE (target) ET l’acteur', () => {
    const row = resolveActivityRow(
      evt({
        eventType: 'member.remove',
        targetId: 'user-bob-000042',
        metadata: { vault_id: 'vault1' },
      }),
      ctx({
        emailByUserId: new Map([
          ['user-alice-0001', 'alice@x.com'],
          ['user-bob-000042', 'bob@x.com'],
        ]),
      })
    );
    expect(row.params.actor).toBe('alice@x.com');
    expect(row.params.target).toBe('bob@x.com');
  });

  it('acteur inconnu ⇒ userId tronqué à 8 — jamais l’id entier à l’écran', () => {
    const row = resolveActivityRow(evt(), ctx({ emailByUserId: new Map() }));
    expect(row.params.actor).toBe('user-ali');
  });

  /**
   * LES TROIS FAMILLES ARRIVÉES AVEC F12/F13, ET POURQUOI LEUR LIBELLÉ SE TESTE
   * ICI PLUTÔT QU'AILLEURS.
   *
   * `VaultActivityPanel` rend `t(row.i18nKey, params)` SANS repli : une clé
   * absente n'est pas un blanc, c'est la chaîne littérale
   * `teamVaults.activity.event.vault_create` affichée à l'utilisateur, à chaque
   * coffre créé ou renommé. Et `npm run i18n:check` ne peut pas l'attraper — il
   * vérifie la parité EN↔FR, or la clé manquait des DEUX côtés. Le seul endroit
   * où le défaut est visible est donc ici : la dérivation de la clé, confrontée
   * aux deux dictionnaires.
   */
  it('les trois familles de F12/F13 ont leur clé ET leur libellé dans les DEUX langues', () => {
    const lookup = (dict: unknown, key: string): unknown =>
      key.split('.').reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
          return (acc as Record<string, unknown>)[part];
        }
        return undefined;
      }, dict);

    const attendu: Array<[string, string]> = [
      ['vault.create', 'teamVaults.activity.event.vault_create'],
      ['vault.rename', 'teamVaults.activity.event.vault_rename'],
      ['vault.settings.update', 'teamVaults.activity.event.vault_settings_update'],
      ['member.item.add', 'teamVaults.activity.event.member_item_add'],
    ];
    for (const [eventType, key] of attendu) {
      const row = resolveActivityRow(evt({ eventType, metadata: {} }), ctx());
      expect(row.i18nKey, eventType).toBe(key);
      expect(typeof lookup(en, key), `EN ${key}`).toBe('string');
      expect(typeof lookup(fr, key), `FR ${key}`).toBe('string');
    }
  });

  it('vault.settings.update ne fait passer AUCUNE section en paramètre — le libellé n’en attend pas', () => {
    // `metadata.sections` reste dans le journal (interrogeable, exportable),
    // mais il ne devient pas un paramètre : les noms de section sont des jetons
    // du serveur ('invitations', 'permissions'), pas du texte traduit, et les
    // afficher tels quels donnerait une phrase à moitié anglaise en français.
    const row = resolveActivityRow(
      evt({ eventType: 'vault.settings.update', metadata: { sections: ['invitations'] } }),
      ctx()
    );
    expect(row.params.sections).toBeUndefined();
    expect(en.teamVaults.activity.event.vault_settings_update).not.toContain('{{sections}}');
    expect(fr.teamVaults.activity.event.vault_settings_update).not.toContain('{{sections}}');
  });

  /**
   * UNE LIGNE SANS AUTEUR EXISTE VRAIMENT (F21), et elle doit se rendre.
   *
   * La relance automatique d'invitation est écrite par le CRON : son
   * `actorUserId` est `null`. Le modèle n'invente alors aucun acteur — il OMET
   * le paramètre — et c'est le libellé qui doit se passer de `{{actor}}`, sans
   * quoi la ligne s'afficherait « {{actor}} a relancé… » en toutes lettres. Les
   * deux moitiés de la règle sont éprouvées ici : le paramètre absent, et la
   * phrase qui ne le réclame pas.
   */
  it('un événement SANS auteur (relance du cron) ne fabrique pas d’acteur', () => {
    const row = resolveActivityRow(
      evt({ eventType: 'member.invite.auto_resend', actorUserId: null, metadata: {} }),
      ctx()
    );
    expect(row.params.actor).toBeUndefined();
    expect(row.i18nKey).toBe('teamVaults.activity.event.member_invite_auto_resend');
    expect(en.teamVaults.activity.event.member_invite_auto_resend).not.toContain('{{actor}}');
    expect(fr.teamVaults.activity.event.member_invite_auto_resend).not.toContain('{{actor}}');
  });

  /**
   * LES CINQ AUTRES ÉVÉNEMENTS DE LA VAGUE 3 — les trois destructions de F20 et
   * les deux bascules du GEL (F23) — se lisent dans les deux langues.
   *
   * `VaultActivityPanel` rend `t(row.i18nKey, params)` SANS repli : une clé
   * absente n'est pas un blanc, c'est la chaîne littérale
   * `teamVaults.activity.event.vault_freeze` affichée à l'utilisateur, à chaque
   * gel. Et `npm run i18n:check` ne peut pas l'attraper — il vérifie la parité
   * EN↔FR, or une clé oubliée manque des DEUX côtés.
   */
  it('les gestes de la vague 3 (F20 destructions, F23 gel) se lisent dans les deux langues', () => {
    for (const type of [
      'member.item.purge',
      'vault.trash.empty',
      'vault.purge',
      'vault.freeze',
      'vault.unfreeze',
      // La repeinte (CHANGES-2026-09.md, §2). Sans libellé, la ligne serait
      // REÇUE mais rendue en toutes lettres : « teamVaults.activity.event.
      // vault_appearance », à chaque changement de couleur.
      'vault.appearance',
    ]) {
      const row = resolveActivityRow(evt({ eventType: type, metadata: {} }), ctx());
      const evenements = (dict: unknown): Record<string, unknown> =>
        (dict as { teamVaults: { activity: { event: Record<string, unknown> } } }).teamVaults
          .activity.event;
      const cle = row.i18nKey.split('.').pop() as string;
      expect(typeof evenements(en)[cle], `EN ${type}`).toBe('string');
      expect(typeof evenements(fr)[cle], `FR ${type}`).toBe('string');
    }
  });

  it('rotation : expose l’époque ; invitation : expose le rôle — jamais l’identifiant du porteur', () => {
    const rot = resolveActivityRow(
      evt({ eventType: 'vault.rotate', metadata: { new_epoch: 3, removed: 1 } }),
      ctx()
    );
    expect(rot.params.epoch).toBe(3);
    const inv = resolveActivityRow(
      evt({ eventType: 'member.invite', metadata: { role: 'member', invite_id: 'inv-9' } }),
      ctx()
    );
    expect(inv.params.role).toBe('member');
    expect(JSON.stringify(inv.params)).not.toContain('inv-9');
  });
});

/**
 * QUI A ÉTÉ INVITÉ ? — la jointure se fait ICI, jamais sur le serveur.
 *
 * LE DÉFAUT QUE CECI FERME. Le fil affichait « a invité quelqu'un » sans jamais
 * nommer la personne : cinq lignes indiscernables pour cinq invitations, et
 * aucun moyen de savoir laquelle avait été reprise. Le silence est VOULU côté
 * serveur — l'audit ne porte jamais d'adresse, c'est une règle dure — mais il
 * porte `metadata.invite_id`, et le client, lui, connaît les invitations du
 * coffre. La jointure est donc LOCALE : le serveur n'en apprend rien, et
 * l'écran cesse de parler d'un inconnu.
 *
 * LA MOITIÉ QUI COMPTE VRAIMENT EST LA SECONDE. Les invitations ne sont connues
 * que sur une fenêtre (réglées 14 jours, échues 30) : passé ce délai, l'index
 * ne contient plus rien pour cet identifiant. On ne DEVINE alors pas — la
 * formule sans nom reste, et c'est la même règle que partout dans ce dossier :
 * ne jamais tirer un verdict d'une absence d'information.
 */
describe('resolveActivityRow — nommer l’invité, sans jamais l’inventer', () => {
  const INVITATIONS = [
    'member.invite',
    'member.invite.revoke',
    'member.invite.resend',
    'member.invite.decline',
    'member.invite.auto_resend',
  ] as const;

  const connu = (o: Partial<ActivityRowContext> = {}) =>
    ctx({ emailByInviteId: new Map([['inv-9', 'bob@x.com']]), ...o });

  const invitation = (type: string, meta: Record<string, unknown> = {}) =>
    evt({ eventType: type, metadata: { invite_id: 'inv-9', ...meta } });

  it('une invitation INCONNUE du client ⇒ aucun nom inventé', () => {
    // Réglée depuis plus de quatorze jours, échue depuis plus de trente : le
    // client n'a plus la ligne. Rendre alors l'identifiant, ou pire une adresse
    // approchante, serait une affirmation tirée d'une ignorance.
    for (const type of INVITATIONS) {
      const row = resolveActivityRow(invitation(type), connu({ emailByInviteId: new Map() }));
      expect(row.params.invitee, type).toBeUndefined();
      expect(row.i18nKey, type).toBe(`teamVaults.activity.event.${type.replace(/\./g, '_')}`);
    }
  });

  it('aucun index d’invitations du tout (volet de l’explorateur) ⇒ idem', () => {
    // Trois écrans partagent ce modèle et n'ont pas tous les invitations du
    // coffre sous la main. L'absence d'index est un « je ne sais pas », pas un
    // « personne » : la phrase d'avant reste, entière et vraie.
    const row = resolveActivityRow(invitation('member.invite', { role: 'member' }), ctx());
    expect(row.params.invitee).toBeUndefined();
    expect(row.i18nKey).toBe('teamVaults.activity.event.member_invite');
  });

  it('les cinq événements d’invitation nomment la personne quand elle est connue', () => {
    for (const type of INVITATIONS) {
      const row = resolveActivityRow(invitation(type), connu());
      expect(row.params.invitee, type).toBe('bob@x.com');
      expect(row.i18nKey, type).toBe(`teamVaults.activity.event.${type.replace(/\./g, '_')}_named`);
    }
  });

  it('l’adresse est rendue EN CLAIR, comme partout ailleurs sur cette page', () => {
    // Les onglets Membres et Invitations affichent déjà les adresses en clair à
    // qui gère le coffre. Les masquer ICI seulement ne protégerait personne et
    // rendrait deux lignes de la même page contradictoires.
    const row = resolveActivityRow(invitation('member.invite', { role: 'member' }), connu());
    expect(row.params.invitee).toBe('bob@x.com');
    expect(row.params.role).toBe('member');
  });

  it('les dix libellés (nommé et anonyme) existent dans les DEUX langues', () => {
    // Le composant rend `t(row.i18nKey, params)` SANS repli : une clé absente
    // n'est pas un blanc, c'est la chaîne littérale affichée à l'utilisateur.
    // Et `npm run i18n:check` ne l'attraperait pas — il vérifie la PARITÉ, or
    // une clé oubliée manque des deux côtés.
    const evenements = (dict: unknown): Record<string, unknown> =>
      (dict as { teamVaults: { activity: { event: Record<string, unknown> } } }).teamVaults.activity
        .event;
    for (const type of INVITATIONS) {
      const base = type.replace(/\./g, '_');
      for (const cle of [base, base + '_named']) {
        expect(typeof evenements(en)[cle], `EN ${cle}`).toBe('string');
        expect(typeof evenements(fr)[cle], `FR ${cle}`).toBe('string');
      }
    }
  });

  it('les deux libellés SANS auteur ne réclament pas d’acteur, nommés ou non', () => {
    // Le refus vient de l'invitée et le rappel du cron : ni l'un ni l'autre n'a
    // d'`actorUserId`. Une phrase qui réclamerait `{{actor}}` s'afficherait
    // « {{actor}} a … » en toutes lettres.
    for (const cle of ['member_invite_decline', 'member_invite_auto_resend']) {
      for (const suffixe of ['', '_named']) {
        const libelle = (dict: unknown): string =>
          (dict as { teamVaults: { activity: { event: Record<string, string> } } }).teamVaults
            .activity.event[cle + suffixe];
        expect(libelle(en), `EN ${cle}${suffixe}`).not.toContain('{{actor}}');
        expect(libelle(fr), `FR ${cle}${suffixe}`).not.toContain('{{actor}}');
      }
    }
  });

  it('un événement sans `invite_id` ne se fait pas nommer', () => {
    const row = resolveActivityRow(
      evt({ eventType: 'member.invite', metadata: { role: 'member' } }),
      connu()
    );
    expect(row.params.invitee).toBeUndefined();
    expect(row.i18nKey).toBe('teamVaults.activity.event.member_invite');
  });

  it('un événement d’une AUTRE famille portant un invite_id n’est pas renommé', () => {
    // La liste des cinq types est FERMÉE : seuls des libellés qui attendent
    // `{{invitee}}` peuvent le recevoir. Un `_named` dérivé au hasard serait une
    // clé inexistante, donc une chaîne brute à l'écran.
    const row = resolveActivityRow(
      evt({ eventType: 'member.join', metadata: { invite_id: 'inv-9' } }),
      connu()
    );
    expect(row.params.invitee).toBeUndefined();
    expect(row.i18nKey).toBe('teamVaults.activity.event.member_join');
  });

  it('l’identifiant du porteur ne devient JAMAIS un paramètre, nommé ou non', () => {
    // Ce qu'on affiche est l'adresse, résolue localement — jamais l'identifiant
    // de l'invitation, qui ne veut rien dire pour un humain et désigne un objet
    // que l'écran ne montre pas.
    for (const c of [connu(), ctx()]) {
      const row = resolveActivityRow(invitation('member.invite', { role: 'member' }), c);
      expect(JSON.stringify(row.params)).not.toContain('inv-9');
    }
  });
});

/**
 * CE QU'UN INDEX VIDE NE PROUVE PAS.
 *
 * « Un élément supprimé » est un VERDICT : il affirme qu'une chose a disparu.
 * On ne peut le tirer que d'une liste RÉELLEMENT consultée — un index vide dit
 * seulement qu'on n'a pas lu la liste, et le confondre avec la disparition est
 * exactement l'erreur que ce dossier interdit ailleurs (un verdict définitif
 * tiré d'une absence d'information). Le cas réel : la carte « Dernière
 * activité » de l'Aperçu, dont l'index était une Map toujours vide, lisait
 * « quelqu'un a remplacé le contenu d'un élément supprimé (a1b2c3d4) » pour une
 * note parfaitement vivante — sur les quatre phrases les plus fréquentes d'un
 * coffre habité.
 */
describe('unresolvedItemLabel — le repli n’accuse pas la suppression', () => {
  it('liste jamais lue (aucune autorité) ⇒ le repli neutre', () => {
    expect(unresolvedItemLabel('itemZ', null)).toBe('unknown');
  });

  it('liste faisant autorité et l’élément n’y est plus ⇒ « supprimé »', () => {
    expect(unresolvedItemLabel('itemZ', new Set(['itemA']))).toBe('deleted');
  });

  /**
   * L'ÉLÉMENT EXISTE, ON NE SAIT JUSTE PAS LE NOMMER.
   *
   * Un élément sans nom (`fileName` et `title` vides) est bien dans la liste
   * lue, mais absent de l'index des noms : la ligne du fil retombe alors sur le
   * repli, et l'accuser de suppression serait faux sur une chose qu'on vient de
   * voir. C'est pourquoi le verdict se tire de la LISTE et non de l'index.
   */
  it('l’élément est dans la liste lue mais sans nom ⇒ « inconnu »', () => {
    expect(unresolvedItemLabel('itemZ', new Set(['itemA', 'itemZ']))).toBe('unknown');
  });

  it('les DEUX libellés existent dans les DEUX langues (le composant les rend sans repli)', () => {
    for (const clef of ['deletedItem', 'unknownItem'] as const) {
      expect(typeof en.teamVaults.activity[clef], `EN ${clef}`).toBe('string');
      expect(typeof fr.teamVaults.activity[clef], `FR ${clef}`).toBe('string');
    }
  });
});

describe('vaultActivitySeen — stockage gardé', () => {
  const saved = (globalThis as { localStorage?: Storage }).localStorage;

  afterEach(() => {
    if (saved === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = saved;
    }
  });

  it('sans localStorage (vitest = node) : null / no-op, jamais une exception', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(getSeenCursor('u1', 'v1')).toBeNull();
    expect(() => setSeenCursor('u1', 'v1', { occurredAt: 1, id: 1 })).not.toThrow();
  });

  it('avec un stub : écrit puis relit le couple ; JSON corrompu ⇒ null', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;

    setSeenCursor('u1', 'v1', { occurredAt: 5000, id: 42 });
    expect(getSeenCursor('u1', 'v1')).toEqual({ occurredAt: 5000, id: 42 });
    // Par (utilisateur, coffre) : un autre couple ne voit rien.
    expect(getSeenCursor('u2', 'v1')).toBeNull();

    store.set('filarr-vault-activity-seen:u1:v1', '{PAS DU JSON');
    expect(getSeenCursor('u1', 'v1')).toBeNull();
    store.set('filarr-vault-activity-seen:u1:v1', '{"occurredAt":"pas un nombre","id":1}');
    expect(getSeenCursor('u1', 'v1')).toBeNull();
  });
});

describe('unseenVaultIds — le point du rail', () => {
  it('tête plus récente → présent ; jamais vu → présent ; égalité stricte du couple → absent', () => {
    const heads = [
      { vaultId: 'v-neuf', occurredAt: 5000, id: 10 },
      { vaultId: 'v-jamais-vu', occurredAt: 100, id: 1 },
      { vaultId: 'v-a-jour', occurredAt: 5000, id: 10 },
    ];
    const cursors: Record<string, { occurredAt: number; id: number } | null> = {
      'v-neuf': { occurredAt: 5000, id: 9 },
      'v-jamais-vu': null,
      'v-a-jour': { occurredAt: 5000, id: 10 },
    };
    const out = unseenVaultIds(heads, (vid) => cursors[vid] ?? null);
    expect([...out].sort()).toEqual(['v-jamais-vu', 'v-neuf']);
  });
});
