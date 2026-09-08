/**
 * inviteTimelineModel — LA FRISE D'UNE INVITATION (F22), éprouvée sans React.
 *
 * CE QUE CES TESTS DÉFENDENT, ET POURQUOI AUCUN NE SE VOIT À LA COMPILATION :
 *
 *  · TROIS CRANS, PAS QUATRE. Il n'y a délibérément pas de « Vue » : le parcours
 *    réel d'une invitation passe par un lien cliqué, pas par le chargement d'une
 *    image dans une boîte de réception. Un cran « vue » serait faux la plupart
 *    du temps — et ce serait, en prime, de la donnée comportementale sur un
 *    tiers dans un produit dont le serveur ne sait rien du reste.
 *
 *  · QUI A RELANCÉ. `resendCount` compte les gestes de l'HÔTE ; `remindedAt`
 *    date le rappel du CRON. Les confondre ferait lire « vous avez relancé » à
 *    quelqu'un qui n'a rien fait, ou l'inverse — et le fil d'activité, lui,
 *    écrit déjà sa ligne SANS auteur (`member.invite.auto_resend`).
 *
 *  · LE SORT SE DÉRIVE DE LA MÊME RÈGLE QUE LES SECTIONS. Une invitation
 *    `pending` dont la date est passée est ÉCHUE avant même que le balayage du
 *    worker ne l'ait vue : la frise et la section « Échues » doivent le dire au
 *    même instant, d'où l'appel à `isLapsed` plutôt qu'une seconde comparaison.
 *
 *  · UNE ABSENCE NE CONCLUT RIEN. Un worker d'avant 0078 n'envoie AUCUN des
 *    trois champs de la frise : l'absence rend une frise réduite, jamais une
 *    frise inventée (« relancée 0 fois » serait vrai par hasard, pas par preuve).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  inviteTimeline,
  stepLabel,
  timelineSteps,
  extendsUntilMs,
  type InviteTimeline,
} from '../inviteTimelineModel';
import { groupInvites } from '../inviteLifecycleModel';
import type { VaultInviteDTO } from '../../../../../services/vault/vaultApi';

const NOW = Date.parse('2026-08-30T12:00:00Z');
const JOUR = 86_400_000;

function invite(o: Partial<VaultInviteDTO> = {}): VaultInviteDTO {
  return {
    id: 'inv-1',
    vaultId: 'v1',
    inviteeEmail: 'bob@x.com',
    role: 'member',
    status: 'pending',
    createdAt: '2026-08-25T09:00:00Z',
    expiresAt: '2026-09-01T09:00:00Z',
    ...o,
  };
}

describe('inviteTimeline — le premier cran', () => {
  it('date l’envoi sur createdAt', () => {
    expect(inviteTimeline(invite(), NOW).sentAtMs).toBe(Date.parse('2026-08-25T09:00:00Z'));
  });

  it('ne fabrique aucune date quand createdAt est illisible', () => {
    expect(inviteTimeline(invite({ createdAt: 'pas une date' }), NOW).sentAtMs).toBeNull();
  });
});

describe('inviteTimeline — le cran du milieu : QUI a relancé', () => {
  it('absent quand personne n’a rien relancé (ni hôte, ni cron)', () => {
    expect(inviteTimeline(invite(), NOW).resend).toBeNull();
  });

  it('absent aussi sur un worker d’avant 0078 — les champs manquent, on n’invente pas', () => {
    const t = inviteTimeline(invite({ resendCount: undefined, remindedAt: undefined }), NOW);
    expect(t.resend).toBeNull();
  });

  it('l’HÔTE seul : le compte, sa date, et l’auteur « host »', () => {
    const t = inviteTimeline(invite({ resendCount: 2, lastResentAt: '2026-08-28T10:00:00Z' }), NOW);
    expect(t.resend).toEqual({
      count: 2,
      auto: false,
      author: 'host',
      atMs: Date.parse('2026-08-28T10:00:00Z'),
    });
  });

  it('FILARR seul : `remindedAt` posé sans aucun geste de l’hôte', () => {
    const t = inviteTimeline(invite({ resendCount: 0, remindedAt: '2026-08-30 08:00:00' }), NOW);
    expect(t.resend?.author).toBe('filarr');
    expect(t.resend?.count).toBe(0);
    expect(t.resend?.auto).toBe(true);
    // Le format SQLite est de l'UTC qui ne le dit pas : lu tel quel, la date
    // glisse d'un fuseau entier à l'affichage.
    expect(t.resend?.atMs).toBe(Date.parse('2026-08-30T08:00:00Z'));
  });

  it('LES DEUX : ni l’un ni l’autre n’est effacé, et la date la plus récente gagne', () => {
    // On n'ARBITRE pas entre les deux auteurs — on dit qu'il y a eu les deux.
    // Écrire « relancée par Filarr » à un hôte qui a cliqué lui ferait croire
    // que son geste n'est pas parti.
    const t = inviteTimeline(
      invite({
        resendCount: 1,
        lastResentAt: '2026-08-27T10:00:00Z',
        remindedAt: '2026-08-30 08:00:00',
      }),
      NOW
    );
    expect(t.resend?.author).toBe('both');
    expect(t.resend?.count).toBe(1);
    expect(t.resend?.atMs).toBe(Date.parse('2026-08-30T08:00:00Z'));
  });

  it('un compte sans date reste un compte — la frise n’exige pas l’instant', () => {
    const t = inviteTimeline(invite({ resendCount: 3, lastResentAt: null }), NOW);
    expect(t.resend?.count).toBe(3);
    expect(t.resend?.atMs).toBeNull();
  });

  it('un compte aberrant (négatif, fractionnaire) ne crée pas de cran', () => {
    expect(inviteTimeline(invite({ resendCount: -2 }), NOW).resend).toBeNull();
    expect(inviteTimeline(invite({ resendCount: 1.5 }), NOW).resend).toBeNull();
  });
});

describe('inviteTimeline — le dernier cran : le sort', () => {
  it('acceptée / refusée : le sort et l’instant du règlement', () => {
    const a = inviteTimeline(invite({ status: 'accepted', settledAt: '2026-08-29 14:30:00' }), NOW);
    expect(a.outcome).toBe('accepted');
    expect(a.outcomeAtMs).toBe(Date.parse('2026-08-29T14:30:00Z'));

    expect(inviteTimeline(invite({ status: 'declined', settledAt: null }), NOW).outcome).toBe(
      'declined'
    );
  });

  it('révoquée : une décision, pas un délai', () => {
    const r = inviteTimeline(invite({ status: 'revoked', settledAt: '2026-08-28 09:00:00' }), NOW);
    expect(r.outcome).toBe('revoked');
    expect(r.outcomeAtMs).toBe(Date.parse('2026-08-28T09:00:00Z'));
  });

  it('ÉCHUE AVANT LE CRON : `pending` dont la date est passée se lit « expirée »', () => {
    // La même règle que les sections (`isLapsed`) — sinon la frise dirait « en
    // attente » sous un titre « Échues », au même instant et sur la même ligne.
    const e = inviteTimeline(invite({ expiresAt: '2026-08-29T09:00:00Z' }), NOW);
    expect(e.outcome).toBe('expired');
    expect(e.outcomeAtMs).toBe(Date.parse('2026-08-29T09:00:00Z'));
  });

  it('en attente : le dernier cran porte l’ÉCHÉANCE, pas un règlement', () => {
    const p = inviteTimeline(invite(), NOW);
    expect(p.outcome).toBe('pending');
    expect(p.outcomeAtMs).toBe(Date.parse('2026-09-01T09:00:00Z'));
  });

  it('une échéance illisible ne rend pas l’invitation morte', () => {
    // `isLapsed` refuse de conclure d'une date qu'il n'a pas su lire : déclarer
    // morte une invitation qu'un vieux worker a mal datée retirerait un accès
    // qui fonctionne.
    expect(inviteTimeline(invite({ expiresAt: 'bof' }), NOW).outcome).toBe('pending');
  });
});

describe('timelineSteps — ce que la frise rend, cran par cran', () => {
  const steps = (t: InviteTimeline) => timelineSteps(t).map((s) => `${s.id}:${s.state}`);

  it('en attente sans relance : deux crans, le dernier À VENIR', () => {
    expect(steps(inviteTimeline(invite(), NOW))).toEqual(['sent:done', 'outcome:todo']);
  });

  it('relancée et toujours en attente : trois crans, le dernier à venir', () => {
    expect(
      steps(inviteTimeline(invite({ resendCount: 1, lastResentAt: '2026-08-28T10:00:00Z' }), NOW))
    ).toEqual(['sent:done', 'resent:done', 'outcome:todo']);
  });

  it('acceptée : le dernier cran est FRANCHI', () => {
    expect(steps(inviteTimeline(invite({ status: 'accepted' }), NOW))).toEqual([
      'sent:done',
      'outcome:done',
    ]);
  });

  it('les crans portent leur instant, et le milieu son compte et son auteur', () => {
    const t = inviteTimeline(
      invite({
        status: 'accepted',
        settledAt: '2026-08-29 14:30:00',
        remindedAt: '2026-08-28 08:00:00',
      }),
      NOW
    );
    const [envoi, relance, sort] = timelineSteps(t);
    expect(envoi).toEqual({ id: 'sent', state: 'done', atMs: t.sentAtMs });
    expect(relance).toEqual({
      id: 'resent',
      state: 'done',
      atMs: Date.parse('2026-08-28T08:00:00Z'),
      count: 0,
      author: 'filarr',
    });
    expect(sort).toEqual({
      id: 'outcome',
      state: 'done',
      atMs: Date.parse('2026-08-29T14:30:00Z'),
      outcome: 'accepted',
    });
  });
});

describe('extendsUntilMs — ce que « Prolonger » promet, et quand il ne promet rien', () => {
  it('rend l’échéance que la relance posera, à partir de la durée LUE', () => {
    // La relance ne « prolonge » pas la date existante : le worker repart de
    // MAINTENANT pour la durée réglée du coffre (`inviteTtlDays`). Compter à
    // partir de l'ancienne échéance annoncerait des jours que personne n'écrit.
    expect(extendsUntilMs(NOW, 7)).toBe(NOW + 7 * JOUR);
  });

  it('rend null quand la durée n’a pas été lue — on ne promet pas un défaut', () => {
    expect(extendsUntilMs(NOW, null)).toBeNull();
  });

  it('rend null sur une durée aberrante', () => {
    expect(extendsUntilMs(NOW, 0)).toBeNull();
    expect(extendsUntilMs(NOW, -3)).toBeNull();
  });
});

/**
 * L'INSTANT EST UN SEUL, ET IL VIENT DU REGROUPEMENT (F22).
 *
 * `inviteTimeline` applique la MÊME règle que les sections (`isLapsed`) — mais
 * une même règle nourrie de DEUX instants rend deux verdicts. Et les deux
 * instants existaient : la page date ses sections dans un `useMemo` (donc à la
 * dernière arrivée de données), tandis que l'onglet lisait `Date.now()` à CHAQUE
 * rendu — or cet écran se rend sans cesse (sondage du fil d'activité,
 * rafraîchissement des statistiques, `busy`, frappe dans la ligne d'invitation).
 * Une invitation qui franchissait son échéance entre les deux affichait alors,
 * SUR LA MÊME LIGNE, la pastille orange « Expire bientôt » et son bouton
 * « Prolonger » sous le titre « En attente », avec dessous une frise qui disait
 * « Expirée ». C'est exactement la contradiction que l'en-tête du modèle
 * prétend fermer.
 *
 * D'où la règle : le regroupement PUBLIE l'instant qu'il a utilisé, et la frise
 * l'emprunte. Les deux tests ci-dessous se tiennent par la main — le premier
 * montre que la contradiction est atteignable avec deux horloges, le second que
 * l'écran n'en a plus qu'une.
 */
describe('la frise et la section qui la contient lisent la MÊME horloge', () => {
  /** Une invitation qui meurt UNE SECONDE après le regroupement. */
  const mourante = invite({ expiresAt: new Date(NOW + 1000).toISOString() });
  const groupes = groupInvites({
    invites: [mourante],
    settled: [],
    lapsed: [],
    nowMs: NOW,
    currentKeyEpoch: 0,
    directory: [],
    directoryState: 'ok',
  });

  it('le regroupement publie l’instant dont il a daté ses sections', () => {
    expect(groupes.nowMs).toBe(NOW);
  });

  it('datée de CET instant, la frise dit ce que dit sa section : en attente', () => {
    expect(groupes.pending.map((r) => r.invite.id)).toEqual(['inv-1']);
    expect(inviteTimeline(mourante, groupes.nowMs).outcome).toBe('pending');
  });

  it('datée d’un instant PLUS TARD, la même frise contredit sa section', () => {
    // Ce n'est pas un défaut du modèle : c'est la démonstration que l'instant
    // ne peut pas être relu ailleurs. Deux secondes de rendu suffisent.
    expect(inviteTimeline(mourante, NOW + 2000).outcome).toBe('expired');
    // ... alors que la section, elle, n'a pas bougé : elle est figée au `useMemo`.
    expect(groupes.pending).toHaveLength(1);
  });
});

/**
 * ET L'ÉCRAN EMPRUNTE BIEN CET INSTANT. Le modèle ci-dessus est pur ; le choix
 * de l'horloge, lui, se fait dans le composant, que vitest ne monte pas
 * (environnement `node`). Ce garde-fou lit donc le fichier — la seule autorité
 * disponible ici, une parité entre deux dérivés ne garderait rien.
 *
 * UNE horloge fraîche subsiste, et une seule : celle de l'infobulle
 * « Prolonger », qui annonce une échéance À VENIR (`maintenant + TTL`) et doit
 * donc partir de maintenant — la dater du regroupement annoncerait une date déjà
 * en retard du temps passé sur la page.
 */
describe('InvitationsTab : d’où vient l’instant des frises', () => {
  const source = fs.readFileSync(path.join(__dirname, '../InvitationsTab.tsx'), 'utf8');

  it('date ses frises de l’instant PUBLIÉ par le regroupement', () => {
    expect(source).toContain('const nowMs = groups.nowMs;');
  });

  it('ne lit plus qu’UNE horloge fraîche, et c’est celle de « Prolonger »', () => {
    // Les COMMENTAIRES parlent d'horloges sans en lire aucune : on compte le
    // CODE, sinon le garde-fou tomberait au premier paragraphe qui l'explique.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/Date\.now\(\)/g) ?? []).toHaveLength(1);
    expect(source).toContain('extendsUntilMs(Date.now(), ttlDays)');
  });
});

describe('le geste de l’hôte ne disparaît pas quand son COMPTE manque', () => {
  it('une date de relance sans compte crédible garde le cran, à zéro', () => {
    // Le worker actuel ne peut pas produire ce couple (`resend_count ?? 0` est
    // posé, et l'UPDATE incrémente le compte en même temps qu'il date). Mais
    // lire une absence comme un zéro effacerait ENTIÈREMENT le geste de la
    // frise — pas « relancée 0 fois », aucun cran du tout — alors que le fichier
    // voisin (`isStaleEpoch`) refuse explicitement de le faire.
    const t = inviteTimeline(
      invite({ resendCount: undefined, lastResentAt: '2026-08-28T10:00:00Z' }),
      NOW
    );
    expect(t.resend).toEqual({
      count: 0,
      auto: false,
      author: 'host',
      atMs: Date.parse('2026-08-28T10:00:00Z'),
    });
  });

  it('ni compte, ni date, ni rappel : toujours pas de cran du milieu', () => {
    expect(inviteTimeline(invite(), NOW).resend).toBeNull();
  });
});

describe('stepLabel — la traduction d’un cran en mots', () => {
  const relance = (author: 'host' | 'filarr' | 'both', count: number) =>
    stepLabel({ id: 'resent', state: 'done', atMs: null, count, author });

  it('l’envoi et le sort nomment leur clé, sans paramètre', () => {
    expect(stepLabel({ id: 'sent', state: 'done', atMs: null })).toEqual({
      key: 'teamVaults.invites.timeline.sent',
    });
    expect(stepLabel({ id: 'outcome', state: 'done', atMs: null, outcome: 'accepted' })).toEqual({
      key: 'teamVaults.invites.timeline.accepted',
    });
  });

  it('LE RAPPEL DE FILARR NE PORTE PAS DE COMPTE', () => {
    // `remindedAt` est posé sans qu'aucun geste de l'hôte ne l'ait été : écrire
    // « relancée 0 fois » lui ferait croire à un clic que personne n'a fait.
    expect(relance('filarr', 0)).toEqual({
      key: 'teamVaults.invites.timeline.resentByFilarr',
    });
  });

  it('les deux auteurs, et l’hôte seul, comptent leurs relances', () => {
    expect(relance('both', 2)).toEqual({
      key: 'teamVaults.invites.timeline.resentBoth',
      params: { count: 2 },
    });
    expect(relance('host', 1)).toEqual({
      key: 'teamVaults.invites.timeline.resent',
      params: { count: 1 },
    });
  });
});
