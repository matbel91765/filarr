/**
 * useOrgAppearance — pose l'apparence choisie par l'organisation.
 *
 * ── LA DIFFÉRENCE ENTRE POSER ET IMPOSER ─────────────────────────────────────
 *
 * Un DÉFAUT se pose une fois : l'équipe se ressemble, et chacun reste libre d'en
 * changer ensuite. Un VERROU se pose à chaque fois : le choix a été retiré des
 * réglages, et le laisser dériver ferait mentir l'écran qui annonce qu'il ne
 * l'est pas.
 *
 * Confondre les deux donne l'un ou l'autre des deux pires comportements
 * possibles : un thème qui revient sans cesse écraser celui que l'utilisateur
 * vient de choisir (défaut traité comme verrou), ou un verrou qui ne tient pas
 * après le premier changement (verrou traité comme défaut). Le repère qui les
 * sépare est ci-dessous, et il est délibérément minuscule.
 *
 * ── LE REPÈRE ────────────────────────────────────────────────────────────────
 *
 * On mémorise la DERNIÈRE valeur d'organisation appliquée, par organisation. Un
 * défaut n'est reposé que lorsque cette valeur CHANGE — c'est-à-dire quand
 * l'administrateur en choisit une autre, ce qui est exactement le moment où il
 * s'attend à voir les postes suivre. Tant qu'elle ne bouge pas, l'utilisateur
 * garde son choix.
 *
 * ── CE QUE CE FICHIER NE PRÉTEND PAS ÊTRE ────────────────────────────────────
 *
 * Une frontière de sécurité. Tout est appliqué par le client, et l'écran
 * d'administration l'affiche sous la mention « appliqué au mieux ». Le thème
 * d'une application n'est pas un secret : c'est une question de cohérence
 * visuelle dans une équipe, et c'est ainsi qu'il est vendu.
 */

import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { selectOrgAppearance, selectIsPluginAllowed } from '../store/slices/governanceSlice';
import { selectCurrentOrgId } from '../store/selectors/authSelectors';
import { applyAppFont } from '../services/platform/appFonts';
import { setOrgPluginFilter } from '../services/plugins/installedPlugins';

/**
 * Transmet la règle « cette extension est-elle autorisée » au service qui charge
 * les extensions.
 *
 * Le service ne connaît ni Redux ni React — il est éprouvé seul, sans magasin —
 * donc c'est l'application qui lui POSE la règle, plutôt que lui qui va la
 * chercher. Tant que personne ne l'a posée, tout passe : une politique absente
 * n'est pas une politique restrictive.
 *
 * Le rappel qui vaut la peine d'être écrit : ceci est du confort. Il évite qu'une
 * extension interdite s'exécute sur un poste bien portant, mais le verrou qui
 * TIENT est le refus du Worker sur le paquet — parce qu'il n'existe aucun autre
 * chemin pour en obtenir les octets.
 */
export function useOrgPluginGate(): void {
  const isAllowed = useSelector(selectIsPluginAllowed);
  useEffect(() => {
    setOrgPluginFilter(isAllowed);
  }, [isAllowed]);
}

/** Ce qui a déjà été appliqué, par organisation — pour ne poser un défaut qu'une fois. */
const APPLIED_KEY = 'filarr.org-appearance-applied';

interface AppliedMark {
  orgId: string;
  theme: string | null;
  fontId: string | null;
}

function readMark(): AppliedMark | null {
  try {
    const raw = localStorage.getItem(APPLIED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppliedMark;
    return typeof parsed?.orgId === 'string' ? parsed : null;
  } catch {
    // Stockage refusé ou valeur abîmée : on repart de « rien appliqué ». Le pire
    // qui puisse en découler est un défaut reposé une fois de trop, jamais un
    // verrou qui lâche.
    return null;
  }
}

function writeMark(mark: AppliedMark): void {
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify(mark));
  } catch {
    /* sans mémoire, le défaut se reposera au prochain démarrage — inoffensif */
  }
}

export function useOrgAppearance(): void {
  const orgId = useSelector(selectCurrentOrgId);
  const { theme, themeLocked, fontId, fontLocked } = useSelector(selectOrgAppearance);
  /** Évite de réécrire le repère à chaque rendu quand rien n'a bougé. */
  const lastApplied = useRef<string>('');

  useEffect(() => {
    if (!orgId) return;
    const signature = `${orgId}|${theme}|${themeLocked}|${fontId}|${fontLocked}`;
    if (lastApplied.current === signature) return;

    const mark = readMark();
    const sameOrg = mark?.orgId === orgId;

    // ── Thème ────────────────────────────────────────────────────────────────
    if (theme) {
      const changed = !sameOrg || mark?.theme !== theme;
      if (themeLocked || changed) {
        // On écrit l'attribut plutôt que de passer par le magasin : ce n'est pas
        // une préférence de l'utilisateur qu'on enregistre, c'est une valeur que
        // l'organisation impose ou propose. La confondre avec son choix propre
        // l'écraserait dans ses réglages.
        document.documentElement.setAttribute('data-theme', theme);
      }
    }

    // ── Police ───────────────────────────────────────────────────────────────
    if (fontId) {
      const changed = !sameOrg || mark?.fontId !== fontId;
      if (fontLocked || changed) {
        // `persist: false` sous verrou — la valeur imposée ne doit pas s'installer
        // dans les préférences du poste, sinon elle y resterait après le départ
        // de l'organisation, sans plus personne pour l'expliquer.
        applyAppFont(fontId, !fontLocked);
      }
    }

    writeMark({ orgId, theme, fontId });
    lastApplied.current = signature;
  }, [orgId, theme, themeLocked, fontId, fontLocked]);
}
