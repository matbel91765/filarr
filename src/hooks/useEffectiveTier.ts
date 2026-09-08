/**
 * useEffectiveTier — le palier que les écrans doivent APPLIQUER.
 *
 * Pas `cloudUser.subscriptionTier` : c'est le palier PERSONNEL, une photo prise
 * à la connexion, qui ne connaît pas les sièges d'organisation. Un membre Teams
 * y lit 'free' — et la modale de partage lui grisait le mot de passe pendant
 * que le serveur lui accordait Teams. Le palier effectif vient de
 * `/billing/status`, lu par `OrgCoverageNotice` et publié dans le magasin
 * d'`orgCoverage` ; avant la première lecture, on retombe sur le personnel.
 *
 * Ce hook ne déclenche AUCUNE requête : il lit ce que l'hôte a déjà lu.
 */

import { useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import {
  effectiveTierOf,
  readOrgCoverage,
  subscribeOrgCoverage,
  type OrgCoverage,
} from '../services/account/orgCoverage';

/** La dernière couverture lue, vivante — `null` avant la première lecture. */
export function useOrgCoverage(): OrgCoverage | null {
  return useSyncExternalStore(subscribeOrgCoverage, readOrgCoverage, readOrgCoverage);
}

export function useEffectiveTier(): string {
  const coverage = useOrgCoverage();
  const personal = useSelector((s: RootState) => s.auth.cloudUser?.subscriptionTier ?? 'free');
  return effectiveTierOf(coverage, personal);
}

export default useEffectiveTier;
