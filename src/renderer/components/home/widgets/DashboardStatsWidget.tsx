/**
 * Bloc « Statistiques » — le bandeau HISTORIQUE, d'un seul tenant.
 *
 * Pourquoi il existe alors que trois blocs fins font mieux : l'amorçage écrit
 * `type: 'dashboard-stats'` pour tout profil qui avait déjà le bandeau déplié
 * (voir `seedLayoutDocument`). Sans cette entrée, ces utilisateurs perdraient
 * leurs chiffres au premier lancement de l'accueil modulaire — et un bloc dont
 * le type ne se résout pas s'affiche vide.
 *
 * Il garde son pli mémorisé : `DashboardStats` lit et écrit sa propre préférence
 * de profil, exactement comme avant.
 */

import React from 'react';

import { DashboardStats } from '../../views/Home/DashboardStats';
import type { WidgetProps } from '../widgetOptions';

export const DashboardStatsWidget: React.FC<WidgetProps> = React.memo(
  function DashboardStatsWidget() {
    return <DashboardStats />;
  }
);

export default DashboardStatsWidget;
