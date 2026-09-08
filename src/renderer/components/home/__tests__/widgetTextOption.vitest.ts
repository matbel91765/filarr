/**
 * LE RÉGLAGE DE TEXTE — le seul des trois qui laisse passer de l'inconnu.
 *
 * Un booléen et un choix sont bornés PAR LEUR SCHÉMA : quoi qu'un gabarit
 * transporte, `readBoolOption` rend un booléen et `readEnumOption` rend l'une
 * des valeurs déclarées. Rien d'étranger n'atteint jamais le rendu.
 *
 * Le texte libre, lui, TRAVERSE. Il part dans le `.filarrlayout`, passe par la
 * place de marché, et s'affiche chez quelqu'un qui ne l'a pas écrit. C'est le
 * seul endroit du catalogue de blocs où une donnée d'un inconnu est rendue
 * telle quelle — d'où ces tests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readTextOption, type WidgetOptionSchema } from '../widgetOptions';

const SCHEMA: WidgetOptionSchema = [
  { kind: 'text', key: 'label', labelKey: 'x', fallback: 'défaut', maxLength: 10 },
  {
    kind: 'enum',
    key: 'size',
    labelKey: 'y',
    fallback: 'a',
    choices: [{ value: 'a', labelKey: 'z' }],
  },
];

describe('readTextOption', () => {
  it('rend la valeur écrite quand elle tient', () => {
    expect(readTextOption(SCHEMA, { label: 'court' }, 'label')).toBe('court');
  });

  it('LA GARDE : l’écrêtage se fait à la LECTURE, pas à la saisie', () => {
    // Borner le champ ne borne que ce qu'on tape SOI-MÊME. La valeur arrive
    // aussi par un gabarit installé, par la synchronisation, ou par un fichier
    // écrit à la main — trois chemins qui ne passent par aucun champ. Un titre
    // de section de cent mille caractères est un déni de service sur la mise
    // en page de qui l'installe.
    const monstrueux = 'x'.repeat(100_000);
    expect(readTextOption(SCHEMA, { label: monstrueux }, 'label')).toHaveLength(10);
  });

  it('une valeur qui n’est pas une chaîne retombe sur le repli', () => {
    // Sans ce garde-fou, un gabarit portant un objet ferait rendre
    // « [object Object] » en travers du bloc, et un tableau ferait « a,b,c ».
    for (const bizarre of [{}, [], 42, true, null, undefined]) {
      expect(readTextOption(SCHEMA, { label: bizarre }, 'label')).toBe('défaut');
    }
  });

  it('une clé absente du schéma rend une chaîne vide, pas `undefined`', () => {
    // `undefined` rendu dans du JSX n'affiche rien — mais concaténé quelque
    // part il écrit « undefined » en toutes lettres.
    expect(readTextOption(SCHEMA, { autre: 'x' }, 'inconnue')).toBe('');
  });

  it('demander un champ de TEXTE sur un champ à CHOIX ne rend pas son contenu', () => {
    // Les deux lecteurs sont volontairement stricts sur le `kind` : lire un
    // enum comme du texte contournerait la liste fermée des valeurs, qui est
    // toute la protection de ce type de réglage.
    expect(readTextOption(SCHEMA, { size: 'valeur-inventée' }, 'size')).toBe('');
  });
});

describe('le texte d’un bloc est rendu comme du TEXTE', () => {
  it('aucun bloc n’utilise `dangerouslySetInnerHTML`', () => {
    /**
     * ⚠ LA GARANTIE QUI COMPTE, ET ELLE NE SE VOIT PAS AUTREMENT.
     *
     * La tentation est réelle et innocente : on veut que les retours à la ligne
     * d'un bloc de texte s'affichent, on remplace `\n` par `<br>`, et on a
     * ouvert une injection dans une application qui manipule des clés — via un
     * gabarit publié par un inconnu.
     *
     * La bonne réponse est `white-space: pre-wrap`, qui est en CSS. Ce test
     * échoue le jour où quelqu'un prend l'autre chemin.
     */
    const dir = path.join(__dirname, '..', 'widgets');
    const sources = [
      'structureWidgets.tsx',
      'noteWidgets.tsx',
      'libraryWidgets.tsx',
      'pulseWidgets.tsx',
    ];

    for (const file of sources) {
      const code = readFileSync(path.join(dir, file), 'utf-8');
      // ⚠ On cherche la FORME D'USAGE (`={`), pas le mot.
      //
      // Chercher le mot seul a échoué du premier coup — sur le commentaire de
      // `structureWidgets` qui explique précisément pourquoi on ne s'en sert
      // pas. Un garde-fou qui interdit de NOMMER le danger pousse à effacer
      // l'explication pour faire passer le test, ce qui est l'inverse du but.
      expect(/dangerouslySetInnerHTML\s*=\s*\{/.test(code), file).toBe(false);
      // `innerHTML` direct : même faille, autre porte.
      expect(/\.innerHTML\s*=[^=]/.test(code), file).toBe(false);
    }
  });
});
