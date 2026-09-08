/**
 * routeCompat — la compatibilité des ROUTES ANCIENNES, en un seul endroit.
 *
 * Lot A (C3) : un coffre partagé n'a plus de section à part. Son adresse est
 * `/vault-folder/<id>`, et la page « tous mes coffres » (`/vaults`) se replie
 * sur l'accueil. Mais des routes anciennes CIRCULENT ENCORE : onglets persistés
 * dans le blob redux d'un profil, liens profonds, panneaux scindés non
 * focalisés (qui ne passent jamais par React Router). Plutôt que d'apprendre
 * à chaque consommateur deux orthographes, on normalise ICI, et chacun appelle
 * `normalizeRoute` à son entrée :
 *   1. `RouteContent` (tête du `useMemo`) — couvre les panneaux scindés ;
 *   2. `routeToTitle` (useTabNavigation) — le titre d'onglet suit la vraie route ;
 *   3. le transform de persistance des onglets (store/index.ts, côté sortant) —
 *      les onglets persistés sont réécrits à la réhydratation ;
 *   + un effet de `useTabNavigation` qui remplace l'URL legacy (replace: true).
 *
 * POURQUOI `/vault-folder/<id>` ET PAS AUTRE CHOSE.
 *   - PAS `/folder/vault:<id>` : `tabsSlice.pruneOrphanFolderTabs` filtre TOUT
 *     onglet `/folder/<x>` dont `x` n'est pas un dossier connu — l'onglet du
 *     coffre serait tué au premier balayage.
 *   - PAS `/vault/<id>` : `/vault` est le coffre-fort local (useTabNavigation).
 *
 * Lot A (C5) : « Partagé avec moi » n'a plus de page non plus. Ses lignes
 * vivent dans le bandeau de l'accueil (`VaultInboxBanner`), donc l'ancienne
 * adresse `/shared-with-me` se replie sur `/` comme `/vaults`.
 */

/** Préfixe de la route profonde d'un coffre partagé. */
export const VAULT_FOLDER_ROUTE_PREFIX = '/vault-folder/';

/** Le paramètre de requête qui CIBLE un élément dans le coffre (`?item=<id>`). */
export const VAULT_ITEM_QUERY_PARAM = 'item';

/**
 * LA PAGE « Gérer le coffre » (F01) — trois paramètres, et toujours PAS de
 * segment de chemin.
 *
 * `/vault-folder/<id>?view=settings&tab=<onglet>&focus=<userId>`. La tentation
 * était `/vault-folder/<id>/settings` ; elle casse tout : la regex ci-dessous
 * est gourmande (`(.+)`), un sous-chemin donnerait `vaultId='<id>/settings'`
 * et l'écran « Coffre introuvable ». Le pathname reste donc identique à celui
 * de l'explorateur — l'onglet garde son titre et sa persistance — et c'est la
 * requête qui dit quel écran du coffre on regarde, comme `?item=` et comme
 * `/settings?cat=`.
 */
export const VAULT_VIEW_QUERY_PARAM = 'view';
/** L'onglet actif DANS la page de gestion (`?tab=members`). */
export const VAULT_TAB_QUERY_PARAM = 'tab';
/** La ligne à mettre en évidence dans l'onglet (`?focus=<userId>`). */
export const VAULT_FOCUS_QUERY_PARAM = 'focus';
/**
 * L'INTENTION D'OUVRIR la cible, et pas seulement de la montrer (`?open=1`).
 *
 * `?item=` seul VISE : il place l'explorateur dans le bon dossier, sélectionne
 * la carte et la fait défiler à l'écran. C'est exactement ce que veut un
 * raccourci de l'espace personnel — on montre à la personne OÙ ses octets sont
 * partis, sans rien ouvrir dans son dos.
 *
 * La section « Coffres partagés » de l'onglet Notes veut l'autre geste : un clic
 * sur une note doit poser cette note à l'écran, dans l'éditeur, comme un clic
 * sur une note personnelle. Séparer les deux intentions plutôt que de faire
 * ouvrir `?item=` par défaut est ce qui laisse les appelants existants
 * strictement inchangés.
 */
export const VAULT_OPEN_QUERY_PARAM = 'open';

/**
 * Les vues d'un coffre autres que son explorateur. Une seule aujourd'hui ; le
 * type existe pour qu'une valeur inventée dans une URL ne devienne jamais un
 * écran deviné — `vaultTargetFromRoute` l'ignore purement et simplement.
 */
export type VaultRouteView = 'settings';

const VAULT_ROUTE_VIEWS: readonly string[] = ['settings'];

export interface VaultRouteOptions {
  itemId?: string;
  /** Ouvrir la cible (et pas seulement la montrer). Sans `itemId`, ignoré. */
  open?: boolean;
  view?: VaultRouteView;
  tab?: string;
  focus?: string;
}

export interface VaultRouteTarget {
  vaultId: string;
  itemId?: string;
  open?: boolean;
  view?: VaultRouteView;
  tab?: string;
  focus?: string;
}

/**
 * L'adresse canonique d'un coffre partagé.
 *
 * Avec `opts.itemId`, l'adresse CIBLE un élément : `/vault-folder/<id>?item=<itemId>`.
 * C'est ce qu'ouvre un raccourci de l'espace personnel (un fichier dont les
 * octets sont partis dans le coffre) : arriver à la racine du coffre et devoir
 * chercher le document à la main aurait défait tout l'intérêt du raccourci.
 * Avec `opts.view`, elle ouvre la page de gestion, éventuellement sur un onglet
 * et une ligne précis. Sans `opts`, la chaîne est INCHANGÉE — les appelants
 * existants ne bougent pas.
 *
 * L'ordre des paramètres est fixe (item, view, tab, focus) : deux appels aux
 * mêmes arguments rendent la MÊME chaîne, ce dont dépendent les tests d'égalité
 * de route (onglet actif, panneau scindé).
 */
export function vaultFolderRoute(vaultId: string, opts?: VaultRouteOptions): string {
  const base = `${VAULT_FOLDER_ROUTE_PREFIX}${vaultId}`;
  if (!opts) return base;
  const parts: string[] = [];
  const push = (key: string, value: string | undefined) => {
    if (value) parts.push(`${key}=${encodeURIComponent(value)}`);
  };
  push(VAULT_ITEM_QUERY_PARAM, opts.itemId);
  // L'intention SUIT la cible et n'existe pas sans elle : « ouvrir » sans dire
  // quoi promettrait un éditeur que l'explorateur ne saurait pas monter.
  if (opts.itemId && opts.open) parts.push(`${VAULT_OPEN_QUERY_PARAM}=1`);
  push(VAULT_VIEW_QUERY_PARAM, opts.view);
  push(VAULT_TAB_QUERY_PARAM, opts.tab);
  push(VAULT_FOCUS_QUERY_PARAM, opts.focus);
  return parts.length === 0 ? base : `${base}?${parts.join('&')}`;
}

/**
 * La CIBLE d'une route `/vault-folder/<id>[?item=…][&view=…][&tab=…][&focus=…]` :
 * le coffre, et ce que la requête dit de plus. `null` pour toute autre route.
 *
 * La requête est lue à la main plutôt qu'avec `URL` : la route est un chemin
 * relatif, et `new URL()` exigerait une base fictive pour un travail que deux
 * `split` font sans ambiguïté.
 *
 * LA BOUCLE VA JUSQU'AU BOUT. Elle s'arrêtait au premier `item` rencontré —
 * un `break` qui suffisait quand il n'y avait qu'un paramètre à lire, et qui
 * aurait avalé en silence tout ce qui se serait rangé derrière lui
 * (`?item=…&view=settings` aurait ouvert l'explorateur). L'ordre des
 * paramètres ne décide donc de rien.
 */
export function vaultTargetFromRoute(route: string): VaultRouteTarget | null {
  const [path, query = ''] = route.split('?', 2);
  const m = path.match(/^\/vault-folder\/(.+)$/);
  if (!m) return null;
  const target: VaultRouteTarget = { vaultId: m[1] };
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const raw = eq === -1 ? '' : pair.slice(eq + 1);
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Une séquence % malformée : on garde la valeur brute plutôt que de
      // perdre la cible — l'élément ne sera simplement pas trouvé.
    }
    if (!value) continue;
    if (key === VAULT_ITEM_QUERY_PARAM) target.itemId = value;
    // SEUL `1` ouvre. Même discipline que la vue inconnue : on ne devine pas un
    // écran. Un `open=0` hérité d'un onglet persisté ne doit surtout pas faire
    // surgir une modale d'édition au rechargement de l'application.
    else if (key === VAULT_OPEN_QUERY_PARAM && value === '1') target.open = true;
    // Une vue inconnue est JETÉE, pas devinée : mieux vaut retomber sur
    // l'explorateur (ce que la route dit déjà) qu'ouvrir un écran au hasard.
    else if (key === VAULT_VIEW_QUERY_PARAM && VAULT_ROUTE_VIEWS.includes(value))
      target.view = value as VaultRouteView;
    else if (key === VAULT_TAB_QUERY_PARAM) target.tab = value;
    else if (key === VAULT_FOCUS_QUERY_PARAM) target.focus = value;
  }
  // Une intention orpheline ne survit pas à la lecture : sans cible, il n'y a
  // rien à ouvrir, et la porter plus loin ferait chercher un élément inexistant.
  if (target.open && !target.itemId) delete target.open;
  return target;
}

// ── Une note de coffre, DANS l'onglet Notes ──────────────────────────────────

/** L'onglet Notes. `/notes/<id>` y désigne déjà une note PERSONNELLE. */
export const NOTES_ROUTE_PREFIX = '/notes/';
/** Le segment qui distingue une note de COFFRE d'un identifiant de note locale. */
export const NOTES_VAULT_SEGMENT = 'vault';

export interface NotesVaultNoteTarget {
  vaultId: string;
  itemId: string;
}

/**
 * L'adresse d'une note de coffre OUVERTE DANS L'ONGLET NOTES.
 *
 * `vaultNoteDestination` promettait déjà, en commentaire, que le lien profond
 * d'une note de coffre naîtrait ICI le jour où il existerait. Le voici — et il
 * ne mène plus à l'explorateur du coffre : la personne qui clique une note dans
 * la section « Coffres partagés » de l'onglet Notes demande à LIRE UNE NOTE,
 * pas à visiter un dossier. Elle reste donc dans l'onglet où elle est.
 *
 * POURQUOI DANS LE CHEMIN, ET PAS EN `?item=` COMME DU CÔTÉ COFFRE. Parce que
 * les deux adresses ne sont pas retenues de la même façon. `useTabNavigation`
 * n'enregistre dans l'onglet que `location.pathname` — et c'est l'onglet, pas
 * l'URL, que redux-persist conserve d'une session à l'autre. Une note portée par
 * une requête survivrait au clic et à rien d'autre : un aller-retour entre deux
 * onglets, ou un rechargement, rouvriraient un panneau de notes vide sans qu'un
 * mot ne l'explique. L'explorateur de coffre, lui, peut se permettre `?item=` :
 * la route SANS la requête (`/vault-folder/<id>`) reste une destination
 * parfaitement sensée, et c'est ce qu'il retrouve.
 *
 * Trois segments, dont le premier est littéral : aucun identifiant de note
 * personnelle ne peut prendre cette forme (`/notes/<id>` n'a qu'un segment, et
 * un segment ne contient pas de barre oblique).
 */
export function notesVaultNoteRoute(vaultId: string, itemId: string): string {
  return `${NOTES_ROUTE_PREFIX}${NOTES_VAULT_SEGMENT}/${encodeURIComponent(
    vaultId
  )}/${encodeURIComponent(itemId)}`;
}

/**
 * La note de coffre que porte une route de l'onglet Notes, sinon `null`.
 *
 * `null` sur la moindre irrégularité — segment manquant, segment vide, segment
 * en trop, séquence `%` malformée. Deviner une cible ici ferait monter un
 * éditeur sur un élément que personne n'a demandé ; ne rien rendre laisse
 * simplement l'onglet Notes se comporter comme d'habitude.
 */
export function notesVaultNoteFromRoute(route: string): NotesVaultNoteTarget | null {
  const [path] = route.split('?', 2);
  if (!path.startsWith(NOTES_ROUTE_PREFIX)) return null;
  const parts = path.slice(NOTES_ROUTE_PREFIX.length).split('/');
  if (parts.length !== 3 || parts[0] !== NOTES_VAULT_SEGMENT) return null;
  try {
    const vaultId = decodeURIComponent(parts[1]);
    const itemId = decodeURIComponent(parts[2]);
    if (!vaultId || !itemId) return null;
    return { vaultId, itemId };
  } catch {
    // Séquence % malformée : pas de cible plutôt qu'une cible fausse.
    return null;
  }
}

/**
 * L'identifiant porté par une route `/vault-folder/<id>`, sinon `null`. La
 * requête (`?item=…`) est IGNORÉE : elle ne fait pas partie de l'identité du
 * coffre, et un titre d'onglet ou un test d'égalité ne doit pas la voir.
 */
export function vaultIdFromRoute(route: string): string | null {
  return vaultTargetFromRoute(route)?.vaultId ?? null;
}

/**
 * Ramène une route legacy à sa forme canonique ; rend la route INCHANGÉE
 * (même référence) sinon, pour que les appelants puissent tester l'égalité.
 *
 *   '/vaults'         → '/'
 *   '/vaults/<id>'    → '/vault-folder/<id>'
 *   '/vaults/<id>?q'  → '/vault-folder/<id>?q'   (la requête PASSE, intacte)
 *   '/shared-with-me' → '/'   (C5 : le bandeau de l'accueil porte ces lignes)
 *   tout le reste     → identique (y compris `/vaultsX`, qui n'est pas legacy)
 *
 * La requête d'une route n'est jamais réécrite : `?item=<id>` (la cible d'un
 * raccourci) doit survivre à la normalisation, sinon un lien profond ancien
 * arriverait au bon coffre mais au mauvais endroit.
 */
export function normalizeRoute(route: string): string {
  if (route === '/vaults' || route === '/vaults/') return '/';
  if (route === '/shared-with-me' || route === '/shared-with-me/') return '/';
  const m = route.match(/^\/vaults\/([^?]+)(\?.*)?$/);
  if (m) return `${vaultFolderRoute(m[1])}${m[2] ?? ''}`;
  return route;
}

/** Vrai si la route est une orthographe ancienne que `normalizeRoute` réécrit. */
export function isLegacyRoute(route: string): boolean {
  return normalizeRoute(route) !== route;
}

// ─────────────────────────────────────────────────────────────────────────────
// Réécriture des onglets persistés
// ─────────────────────────────────────────────────────────────────────────────

interface TabLike {
  route: string;
  title?: string;
  [k: string]: unknown;
}
interface PanelLike {
  tabs?: TabLike[];
  [k: string]: unknown;
}
interface TabsStateLike {
  panels?: PanelLike[];
  [k: string]: unknown;
}

/**
 * Réécrit les routes legacy des onglets d'un état `tabs` réhydraté. Fonction
 * PURE, séparée du transform redux-persist pour être testable sans monter le
 * store (qui touche localStorage à l'import).
 *
 * Rend l'état INCHANGÉ (même référence) si aucun onglet n'est legacy : une
 * réhydratation ne doit pas fabriquer un nouvel objet pour rien.
 *
 * Titre : un onglet `/vaults` devient un onglet `/`, et son titre (« Coffres
 * d'équipe ») mentirait ; on lui donne celui de l'onglet d'accueil déjà
 * présent quand il y en a un. Les autres titres sont conservés — le nom d'un
 * coffre reste juste, et `useTabNavigation` le recalcule de toute façon dès
 * que l'onglet redevient actif.
 */
export function rewriteLegacyTabRoutes<S extends TabsStateLike>(state: S): S {
  if (!state || !Array.isArray(state.panels)) return state;
  let changed = false;
  const panels = state.panels.map((panel) => {
    if (!panel || !Array.isArray(panel.tabs)) return panel;
    const homeTitle = panel.tabs.find((t) => t && t.route === '/')?.title;
    let panelChanged = false;
    const tabs = panel.tabs.map((tab) => {
      if (!tab || typeof tab.route !== 'string') return tab;
      const route = normalizeRoute(tab.route);
      if (route === tab.route) return tab;
      panelChanged = true;
      const next: TabLike = { ...tab, route };
      if (route === '/' && homeTitle) next.title = homeTitle;
      return next;
    });
    if (!panelChanged) return panel;
    changed = true;
    return { ...panel, tabs };
  });
  return changed ? { ...state, panels } : state;
}
