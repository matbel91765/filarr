/**
 * PUBLIER — les règles, éprouvées hors de tout écran.
 *
 * Ce module est pur, donc il se teste entièrement. Trois choses y valent
 * vraiment le test, et aucune ne se voit à la relecture :
 *
 *   · un refus du serveur ramène à l'étape COUPABLE, et le cas qui compte est
 *     `layout_rejected:*` → l'assainissement ;
 *   · un code composé ne doit JAMAIS servir de clé i18n telle quelle (i18next
 *     lit `:` comme un séparateur d'espace de noms) ;
 *   · la suggestion d'identifiant produit toujours un slug que le worker
 *     accepte, y compris à partir d'un nom français ou d'un nom qui commence
 *     par un chiffre.
 */

import { describe, it, expect } from 'vitest';

import {
  EMPTY_LAYOUT_DRAFT,
  MAX_DESCRIPTION,
  MAX_NAME,
  errorMessageKey,
  issueOfField,
  issuesOfStep,
  layoutDraftIssues,
  stepForLayoutErrorCode,
  suggestSlug,
  type LayoutPublishDraft,
} from '../layoutPublishValidation';
import { LAYOUT_MARKET_SLUG_RE } from '../../../../services/layouts/layoutMarketTypes';

/** Un brouillon complet et légal — le point de départ de chaque refus testé. */
function draft(over: Partial<LayoutPublishDraft> = {}): LayoutPublishDraft {
  return {
    ...EMPTY_LAYOUT_DRAFT,
    viewId: 'home',
    slug: 'accueil-atelier',
    version: '1.0.0',
    name: 'Accueil — Atelier',
    description: 'Une base sobre.',
    icon: '🗂️',
    category: 'work',
    ...over,
  };
}

const fields = (d: LayoutPublishDraft, pending = 0, rejected = 0): string[] =>
  layoutDraftIssues(d, pending, rejected).map((i) => i.field);

// ==================== 1. Ce qui manque, et où ====================

describe('les manques, et l’étape qui les porte', () => {
  it('un brouillon complet ne signale rien', () => {
    expect(layoutDraftIssues(draft(), 0)).toEqual([]);
  });

  it('sans disposition choisie, le manque est à la PREMIÈRE étape', () => {
    const issues = layoutDraftIssues(draft({ viewId: '' }), 0);
    expect(issues.map((i) => i.step)).toEqual(['layout']);
    expect(issueOfField(issues, 'view')).toBeDefined();
  });

  it('un emplacement gardé SANS libellé bloque à l’assainissement', () => {
    // Garder une liaison « comme emplacement nommé » sans rien écrire produit
    // chez celui qui installe un bloc « à brancher sur… » suivi de rien.
    const issues = layoutDraftIssues(draft(), 1);
    expect(issuesOfStep(issues, 'sanitize').map((i) => i.field)).toEqual(['bindings']);
  });

  it('DES BLOCS REFUSÉS bloquent, et à l’assainissement', () => {
    // Le cas réel : l'auteur remplissait tout, cliquait, et le serveur refusait
    // pour un bloc dont rien ne disait le nom — pendant que l'étape
    // d'assainissement annonçait « aucune liaison, rien à retirer ». Sept causes
    // se cachent derrière ce refus, et une seule concerne une liaison.
    const issues = layoutDraftIssues(draft(), 0, 2);
    expect(issues.map((i) => i.step)).toEqual(['sanitize']);
    expect(issues[0].messageKey).toBe('layouts.publish.issues.rejected');

    // Zéro bloc refusé ⇒ rien à signaler : le contrôle ne crie pas dans le vide.
    expect(layoutDraftIssues(draft(), 0, 0)).toEqual([]);
  });

  it('un identifiant hors ASCII minuscule est refusé', () => {
    for (const slug of ['Accueil', 'accueil_atelier', '1accueil', 'a', '-accueil', 'accueil ']) {
      expect(fields(draft({ slug })), slug).toContain('slug');
    }
  });

  it('une version qui n’est pas un semver strict est refusée', () => {
    for (const version of ['1.0', '1.0.0-beta', 'latest', '']) {
      expect(fields(draft({ version })), version).toContain('version');
    }
  });

  it('un nom vide ou trop long est refusé', () => {
    expect(fields(draft({ name: '   ' }))).toContain('name');
    expect(fields(draft({ name: 'x'.repeat(MAX_NAME + 1) }))).toContain('name');
    // La borne PORTE SUR LES POINTS DE CODE : un nom entièrement en emoji
    // compte deux fois plus d'unités UTF-16 que de caractères, et une borne
    // exprimée en `.length` le refuserait à la moitié de sa longueur réelle.
    expect(fields(draft({ name: '🗂️'.repeat(30) }))).not.toContain('name');
  });

  it('une description trop longue est refusée, une description vide ne l’est pas', () => {
    expect(fields(draft({ description: '' }))).not.toContain('description');
    expect(fields(draft({ description: 'x'.repeat(MAX_DESCRIPTION + 1) }))).toContain(
      'description'
    );
  });

  it('une icône vide est légale, une icône qui n’est pas un emoji ne l’est pas', () => {
    expect(fields(draft({ icon: '' }))).not.toContain('icon');
    expect(fields(draft({ icon: 'A' }))).toContain('icon');
    expect(fields(draft({ icon: '<img src=x>' }))).toContain('icon');
    expect(fields(draft({ icon: '👨‍👩‍👧‍👦' }))).not.toContain('icon');
  });
});

// ==================== 2. Un refus ramène à l'étape coupable ====================

describe('un refus du serveur rouvre l’étape fautive', () => {
  it('LE CAS QUI COMPTE : `layout_rejected:*` ramène à l’assainissement', () => {
    // Le worker vient de dire qu'un bloc porte encore un identifiant. C'est
    // exactement l'étape qui sert à l'enlever — et sans cette ligne, l'auteur
    // relirait son formulaire en entier sans savoir quoi corriger.
    for (const code of [
      'layout_rejected:binding-identifier',
      'layout_rejected:bad-options',
      'layout_rejected:url-value',
    ]) {
      expect(stepForLayoutErrorCode(code), code).toEqual({
        step: 'sanitize',
        field: 'bindings',
      });
    }
  });

  it('les refus d’identité rouvrent le bon champ', () => {
    expect(stepForLayoutErrorCode('slug_taken')).toEqual({ step: 'identity', field: 'slug' });
    expect(stepForLayoutErrorCode('version_exists')).toEqual({
      step: 'identity',
      field: 'version',
    });
    expect(stepForLayoutErrorCode('bad_envelope:bad-icon')).toEqual({
      step: 'identity',
      field: 'icon',
    });
  });

  it('un fichier sans bloc lisible ramène au CHOIX de la disposition', () => {
    expect(stepForLayoutErrorCode('bad_envelope:no-widgets')).toEqual({
      step: 'layout',
      field: 'view',
    });
  });

  it('ce qui ne se corrige dans aucun champ ne rouvre rien', () => {
    // Signature, empreinte, quota : les afficher sur un champ suggérerait qu'on
    // peut les réparer en tapant, ce qui est faux.
    for (const code of ['bad_signature', 'fingerprint_mismatch', 'rate_limited', null]) {
      expect(stepForLayoutErrorCode(code), String(code)).toBeNull();
    }
  });
});

// ==================== 3. Le piège des deux-points ====================

describe('clé i18n d’un code d’erreur — le piège i18next', () => {
  it('un code COMPOSÉ perd sa partie détail', () => {
    // `t('…errors.layout_rejected:binding-identifier')` chercherait la clé
    // `binding-identifier` dans l'espace de noms `…errors.layout_rejected`, ne
    // la trouverait pas, et afficherait la chaîne brute à l'utilisateur.
    expect(errorMessageKey('layout_rejected:binding-identifier')).toBe('layout_rejected');
    expect(errorMessageKey('bad_envelope:bad-name')).toBe('bad_envelope');
  });

  it('un code simple passe tel quel, et l’absence de code devient « unknown »', () => {
    expect(errorMessageKey('slug_taken')).toBe('slug_taken');
    expect(errorMessageKey(null)).toBe('unknown');
    expect(errorMessageKey('')).toBe('unknown');
    expect(errorMessageKey(':orphelin')).toBe('unknown');
  });

  it('AUCUNE clé rendue ne contient de deux-points', () => {
    for (const code of [
      'layout_rejected:binding-identifier',
      'bad_envelope:no-widgets',
      'slug_taken',
      null,
    ]) {
      expect(errorMessageKey(code)).not.toContain(':');
    }
  });
});

// ==================== 4. La suggestion d'identifiant ====================

describe('suggérer un identifiant à partir d’un nom', () => {
  it('un nom français produit un slug ASCII que le worker accepte', () => {
    // Sans dépliage des diacritiques, « Accueil — Été » donnerait une suite de
    // tirets : le slug est en ASCII pur, et c'est voulu (deux adresses qui se
    // ressemblent à l'œil sans être égales aux octets font une usurpation).
    const slug = suggestSlug('Accueil — Été créatif');
    expect(slug).toBe('accueil-ete-creatif');
    expect(LAYOUT_MARKET_SLUG_RE.test(slug)).toBe(true);
  });

  it('un nom qui commence par un chiffre reste un slug légal', () => {
    // `^[a-z]` est exigé par le worker : sans le préfixe, la suggestion
    // produirait un slug refusé à la publication, après tout le formulaire.
    const slug = suggestSlug('2026 en un coup d’œil');
    expect(LAYOUT_MARKET_SLUG_RE.test(slug)).toBe(true);
    expect(slug.startsWith('a-')).toBe(true);
  });

  it('un nom sans aucune lettre ni chiffre ne suggère rien', () => {
    // Rien vaut mieux qu'un slug inventé : le champ reste vide et visible.
    expect(suggestSlug('— … —')).toBe('');
    expect(suggestSlug('')).toBe('');
  });

  it('un nom très long est écrêté sous la borne du worker', () => {
    const slug = suggestSlug('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(LAYOUT_MARKET_SLUG_RE.test(slug)).toBe(true);
  });

  it('les tirets de bordure sont retirés', () => {
    expect(suggestSlug('  — Atelier —  ')).toBe('atelier');
  });
});
