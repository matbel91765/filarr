/**
 * sourceScan.ts — Retire commentaires et chaines d'un source TypeScript.
 *
 * Utilitaire des gardes de CABLAGE (`wiring.vitest.ts`). Ce n'est pas une
 * suite : pas de `describe`, pas de `it`. Il vit quand meme dans `__tests__/`
 * parce que `electron/tsconfig.json` exclut ce dossier de l'emission — un
 * utilitaire de test n'a rien a faire dans `dist-electron`.
 *
 * ── POURQUOI IL EXISTE ───────────────────────────────────────────────────────
 * Une garde qui cherche `vaultWatcher.start()` dans le texte brut d'un fichier
 * MENT : elle reste verte quand l'appel a ete commente. Verifie en sabotant le
 * cablage exprès — la garde n'a pas bronche, alors que l'appel commente est
 * exactement le bogue qu'elle doit attraper.
 *
 * Les chaines litterales partent pour la meme raison : un message de
 * journalisation qui cite `stampedChecksum` ne prouve aucun appel.
 *
 * ── UN SCANNER, PAS UNE EXPRESSION REGULIERE ─────────────────────────────────
 * Le faire a coups de `replace(/.../)` demande des echappements que le moindre
 * outil intermediaire abime, et une expression fausse rend un resultat
 * plausible — donc une garde qui ment autrement. Un parcours caractere par
 * caractere est plus long a lire et impossible a casser de travers.
 *
 * Il ne comprend PAS les expressions regulieres litterales du source analyse :
 * elles restent telles quelles. C'est sans consequence ici, aucune garde ne
 * cherche a l'interieur d'une expression reguliere.
 */

/** Rend le source prive de ses commentaires et du contenu de ses chaines. */
export function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = i + 1 < n ? source[i + 1] : '';

    // Commentaire de bloc
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      // Un commentaire non ferme mange le reste : c'est ce que fait le
      // compilateur, autant se comporter pareil.
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }

    // Commentaire de ligne. On garde le saut de ligne : les gardes decoupent
    // parfois par lignes, et les coller changerait le sens.
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    // Chaine simple, double, ou gabarit
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < n) {
        const d = source[i];
        if (d === '\\') {
          i += 2;
          continue;
        }
        if (d === quote) {
          i++;
          break;
        }
        // Une chaine simple ou double ne franchit pas une fin de ligne. Si on
        // en rencontre une, le source est deja invalide : on rend la main
        // plutot que d'avaler tout le fichier.
        if (d === '\n' && quote !== '`') break;
        i++;
      }
      out += quote;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * Le fragment de source qui suit `marker`, sur `length` caracteres.
 *
 * Rend une chaine VIDE si le marqueur est absent, et c'est voulu : une garde
 * qui cherche dans un fragment introuvable doit echouer, pas passer parce
 * qu'elle a cherche dans tout le fichier.
 */
export function sectionAfter(source: string, marker: string, length = 1200): string {
  const at = source.indexOf(marker);
  if (at === -1) return '';
  return source.slice(at, at + length);
}
