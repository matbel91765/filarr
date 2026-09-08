/**
 * Garde-fous du MODÈLE DE FUSION — les quatre pertes de données que la revue de
 * l'écran des notes personnelles avait trouvées, plus les règles de sûreté que
 * l'écran des notes de coffre hérite en s'y branchant.
 *
 * Chacun de ces tests a été vu ROUGE avant d'être vu vert : la règle qu'il
 * décrit a été sabotée dans le code, l'échec constaté, puis l'édition inverse
 * appliquée. Une parité entre deux dérivés ne garde rien — ce qui est confronté
 * ici est l'AUTORITÉ : ce que `planResult` produit réellement, octet pour octet.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMergePlan,
  planOutcome,
  planProgress,
  planResult,
  takeAllChoices,
  TITLE_DECISION,
  WHOLE_DECISION,
  type MergeSide,
} from '../mergePlan';
import type { DiffSide } from '../blockDiff';

// ── Fabriques ────────────────────────────────────────────────────────────────

const para = (text: string): unknown => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const heading = (level: number, text: string): unknown => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
/** Une image dont les attributs ne disent RIEN de lisible (donnée embarquée). */
const image = (payload: string): unknown => ({
  type: 'image',
  attrs: { src: `data:image/png;base64,${payload}` },
});

const doc = (...blocks: unknown[]): string => JSON.stringify({ type: 'doc', content: blocks });

const side = (title: string, content: string, plainText = ''): MergeSide => ({
  title,
  content,
  plainText,
});

/** Les blocs du document résultant, relus depuis la chaîne qui SERA écrite. */
function blocksOf(content: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(content) as { content?: Array<Record<string, unknown>> };
  return parsed.content ?? [];
}

// ── 1. Aucune différence n'a de valeur par défaut ────────────────────────────

describe('aucune différence n’a de valeur par défaut', () => {
  it('ne se déclare réglé qu’une fois CHAQUE décision prise', () => {
    const mine = side('Note', doc(para('commun'), para('à moi'), para('queue')));
    const theirs = side('Note', doc(para('commun'), para('à eux'), para('queue')));
    const plan = buildMergePlan(mine, theirs);

    expect(plan.decisionIds).toHaveLength(1);
    expect(planProgress(plan, {}).settled).toBe(false);
    expect(planProgress(plan, {}).decided).toBe(0);

    const decided = { [plan.decisionIds[0]]: 'theirs' as DiffSide };
    expect(planProgress(plan, decided).settled).toBe(true);
  });

  it('compte le TITRE comme une décision à part entière', () => {
    const mine = side('Mon titre', doc(para('commun'), para('à moi')));
    const theirs = side('Leur titre', doc(para('commun'), para('à eux')));
    const plan = buildMergePlan(mine, theirs);

    expect(plan.titleDiffers).toBe(true);
    expect(plan.decisionIds[0]).toBe(TITLE_DECISION);
    expect(plan.decisionIds).toHaveLength(2);

    // Le document tranché mais pas le titre : il reste une question ouverte.
    const docOnly = { [plan.decisionIds[1]]: 'mine' as DiffSide };
    expect(planProgress(plan, docOnly).settled).toBe(false);
  });
});

// ── 2. Une version gardée entière est RECOPIÉE, jamais reconstruite ──────────

describe('recopie à l’octet', () => {
  /**
   * La chaîne d'entrée porte des espaces que `JSON.stringify` n'écrirait pas :
   * si le résultat était reconstruit, il en différerait. C'est ce qui rend ce
   * test capable de distinguer « recopié » de « reconstruit à l'identique ».
   */
  const espacé = '{"type":"doc",  "content": [{"type":"paragraph"}]}';

  it('rend la chaîne d’origine, inchangée, quand tout va à ma version', () => {
    const mine = side('T', espacé, 'texte à moi');
    const theirs = side('T', doc(para('autre')));
    const plan = buildMergePlan(mine, theirs);
    const result = planResult(plan, takeAllChoices(plan, 'mine'), mine, theirs);

    expect(result.rebuilt).toBe(false);
    expect(result.content).toBe(espacé);
    expect(result.plainText).toBe('texte à moi');
  });

  it('rend la chaîne d’en face, inchangée, quand tout va à leur version', () => {
    const mine = side('T', doc(para('autre')));
    const theirs = side('T', espacé, 'texte à eux');
    const plan = buildMergePlan(mine, theirs);
    const result = planResult(plan, takeAllChoices(plan, 'theirs'), mine, theirs);

    expect(result.rebuilt).toBe(false);
    expect(result.content).toBe(espacé);
    expect(result.plainText).toBe('texte à eux');
  });

  it('ne reconstruit QUE le vrai mélange', () => {
    const mine = side('T', doc(para('a'), para('m1'), para('b'), para('m2'), para('c')));
    const theirs = side('T', doc(para('a'), para('t1'), para('b'), para('t2'), para('c')));
    const plan = buildMergePlan(mine, theirs);
    expect(plan.decisionIds).toHaveLength(2);

    const mixte = { [plan.decisionIds[0]]: 'mine', [plan.decisionIds[1]]: 'theirs' } as Record<
      string,
      DiffSide
    >;
    const result = planResult(plan, mixte, mine, theirs);
    expect(result.rebuilt).toBe(true);
    expect(blocksOf(result.content)).toHaveLength(5);
  });
});

// ── 3. Les ATTRIBUTS D'ORIGINE survivent au mélange ──────────────────────────

describe('les attributs d’origine partent avec le nœud', () => {
  it('un titre de niveau 2 retenu dans un mélange reste un titre de niveau 2', () => {
    const mine = side('T', doc(para('a'), para('m1'), para('b'), para('m2'), para('c')));
    const theirs = side(
      'T',
      doc(para('a'), heading(2, 'Leur titre'), para('b'), para('t2'), para('c'))
    );
    const plan = buildMergePlan(mine, theirs);
    // Un vrai mélange : la première différence à eux, la seconde à moi. Le
    // document est donc RECONSTRUIT — c'est là, et seulement là, qu'un attribut
    // peut se perdre.
    const mixte = { [plan.decisionIds[0]]: 'theirs', [plan.decisionIds[1]]: 'mine' } as Record<
      string,
      DiffSide
    >;
    const result = planResult(plan, mixte, mine, theirs);
    expect(result.rebuilt).toBe(true);

    const retenu = blocksOf(result.content)[1];
    expect(retenu.type).toBe('heading');
    expect(retenu.attrs).toEqual({ level: 2 });
  });

  it('l’ordre du document est celui du document, pas celui des décisions', () => {
    const mine = side('T', doc(para('a'), para('m1'), para('b'), para('m2'), para('c')));
    const theirs = side('T', doc(para('a'), para('t1'), para('b'), para('t2'), para('c')));
    const plan = buildMergePlan(mine, theirs);
    const mixte = { [plan.decisionIds[0]]: 'theirs', [plan.decisionIds[1]]: 'mine' } as Record<
      string,
      DiffSide
    >;
    const result = planResult(plan, mixte, mine, theirs);
    const textes = blocksOf(result.content).map(
      (b) => ((b.content as Array<{ text?: string }>)?.[0]?.text ?? '') as string
    );
    expect(textes).toEqual(['a', 't1', 'b', 'm2', 'c']);
  });
});

// ── 4. « Garder les deux » ne jette rien ─────────────────────────────────────

describe('« garder les deux »', () => {
  it('conserve les DEUX ajouts faits au même endroit, la mienne d’abord', () => {
    const mine = side('T', doc(para('a'), para('mon ajout'), para('b')));
    const theirs = side('T', doc(para('a'), para('leur ajout'), para('b')));
    const plan = buildMergePlan(mine, theirs);
    expect(plan.decisionIds).toHaveLength(1);

    const result = planResult(plan, { [plan.decisionIds[0]]: 'both' as DiffSide }, mine, theirs);
    const textes = blocksOf(result.content).map(
      (b) => ((b.content as Array<{ text?: string }>)?.[0]?.text ?? '') as string
    );
    expect(textes).toEqual(['a', 'mon ajout', 'leur ajout', 'b']);
  });

  it('n’est jamais compté comme « je garde ma version »', () => {
    const mine = side('T', doc(para('a'), para('m1'), para('b')));
    const theirs = side('T', doc(para('a'), para('t1'), para('b')));
    const plan = buildMergePlan(mine, theirs);
    expect(planOutcome(plan, { [plan.decisionIds[0]]: 'both' })).toBe('merge');
  });
});

// ── 5. Les identifiants ne se reportent PAS sur d'autres blocs ───────────────

describe('un choix ne survit pas à un changement du couple comparé', () => {
  it('devient incomptable quand un bloc est inséré en tête', () => {
    const mine = side('T', doc(para('a'), para('m1'), para('b')));
    const theirs = side('T', doc(para('a'), para('t1'), para('b')));
    const avant = buildMergePlan(mine, theirs);
    const choix = takeAllChoices(avant, 'theirs');
    expect(planProgress(avant, choix).settled).toBe(true);

    // Quelqu'un a enregistré entre-temps et a ajouté un paragraphe EN TÊTE :
    // toutes les positions glissent. Le choix pris plus haut ne doit plus
    // compter — sinon le bouton s'armerait et écrirait une fusion que personne
    // n'a vue, avec le côté choisi appliqué au mauvais bloc.
    const theirsBis = side('T', doc(para('nouveau'), para('a'), para('t1'), para('b')));
    const après = buildMergePlan(mine, theirsBis);

    expect(après.signature).not.toBe(avant.signature);
    expect(planProgress(après, choix).decided).toBe(0);
    expect(planProgress(après, choix).settled).toBe(false);
  });

  it('devient incomptable même quand la FORME du document n’a pas bougé', () => {
    // Le cas vicieux, et celui qui perd des données : le nombre et la place des
    // différences sont identiques, seul leur CONTENU a changé. Un identifiant
    // attribué par la seule position (`h1`) désignerait alors « la deuxième
    // différence » des deux côtés, le choix pris sur l'ancien texte serait
    // compté sur le nouveau, le bouton s'armerait — et on écrirait un bloc que
    // personne n'a lu. C'est l'empreinte du couple comparé qui l'interdit.
    const mine = side('T', doc(para('a'), para('m1'), para('b')));
    const avant = buildMergePlan(mine, side('T', doc(para('a'), para('t1'), para('b'))));
    const après = buildMergePlan(mine, side('T', doc(para('a'), para('t2'), para('b'))));

    expect(avant.decisionIds).toHaveLength(1);
    expect(après.decisionIds).toHaveLength(1);
    expect(après.decisionIds[0]).not.toBe(avant.decisionIds[0]);

    const choix = takeAllChoices(avant, 'theirs');
    expect(planProgress(après, choix).decided).toBe(0);
    expect(planProgress(après, choix).settled).toBe(false);
  });
});

// ── 6. Les blocs atomiques restent DISTINGUABLES ─────────────────────────────

describe('blocs sans texte ni résumé', () => {
  it('porte un rang propre à chacun, seul repère quand rien n’est lisible', () => {
    const mine = side('T', doc(para('a'), image('AAAA'), image('BBBB')));
    const theirs = side('T', doc(para('a'), image('CCCC')));
    const plan = buildMergePlan(mine, theirs);

    const hunk = plan.comparison.hunks.find((h) => h.kind !== 'common');
    expect(hunk).toBeDefined();
    const côtéMoi = hunk!.mine;
    expect(côtéMoi).toHaveLength(2);
    // Rien à afficher : ni texte, ni résumé tiré des attributs (une donnée
    // embarquée n'a pas de nom). Sans rang, les deux panneaux sont identiques.
    for (const b of côtéMoi) {
      expect(b.text).toBe('');
      expect(b.summary).toBe('');
    }
    expect(côtéMoi[0].index).not.toBe(côtéMoi[1].index);
  });
});

// ── 7. L'issue que la confirmation NOMME ─────────────────────────────────────

describe('planOutcome', () => {
  const mine = side('Mon titre', doc(para('a'), para('m1'), para('b')));
  const theirs = side('Leur titre', doc(para('a'), para('t1'), para('b')));

  it('« ma version » quand tout, titre compris, vient de moi', () => {
    const plan = buildMergePlan(mine, theirs);
    expect(planOutcome(plan, takeAllChoices(plan, 'mine'))).toBe('mine');
  });

  it('« mélange » dès que le titre vient d’un côté et le document de l’autre', () => {
    const plan = buildMergePlan(mine, theirs);
    const choix = { ...takeAllChoices(plan, 'mine'), [TITLE_DECISION]: 'theirs' as DiffSide };
    expect(planOutcome(plan, choix)).toBe('merge');
  });
});

// ── 8. Deux documents illisibles : une seule décision, et elle recopie ───────

describe('documents non comparables', () => {
  it('n’offre qu’un choix en bloc, et le rend à l’octet', () => {
    const mine = side('T', 'ceci n’est pas du JSON', 'à moi');
    const theirs = side('T', doc(para('a')), 'à eux');
    const plan = buildMergePlan(mine, theirs);

    expect(plan.comparison.comparable).toBe(false);
    expect(plan.decisionIds).toEqual([WHOLE_DECISION]);
    expect(planProgress(plan, {}).settled).toBe(false);

    const pris = planResult(plan, { [WHOLE_DECISION]: 'theirs' }, mine, theirs);
    expect(pris.rebuilt).toBe(false);
    expect(pris.content).toBe(theirs.content);
  });
});
