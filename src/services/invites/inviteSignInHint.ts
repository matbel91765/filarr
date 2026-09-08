/**
 * L'ADRESSE À SAISIR, passée de main en main jusqu'au formulaire de connexion.
 *
 * POURQUOI CE MODULE EXISTE. Quand l'invitation vise B et qu'on est connecté
 * avec A, l'écran d'acceptation dit maintenant « changez de compte » — et sur le
 * bureau « ouvrez un profil relié à B ». Mais le formulaire de connexion, lui,
 * s'ouvrait toujours vide : la personne devait retenir l'adresse qu'un autre
 * écran venait de lui montrer, la retaper sans faute, et une faute de frappe la
 * ramenait exactement là où elle était. Ce module est le PASSE-PLAT qui évite
 * ça, et rien d'autre.
 *
 * POURQUOI PAR LE STOCKAGE, ET PAS PAR UNE PROP. Entre l'écran qui connaît
 * l'adresse et le formulaire qui la réclame, il y a — selon le chemin — une
 * déconnexion, un écran de verrouillage, un retour au sélecteur de profils, un
 * assistant d'ajout de compte. Faire descendre une prop le long de cette chaîne
 * demanderait de traverser des composants qui n'ont rien à voir avec les
 * invitations. Le précédent existe déjà dans ce dépôt (`filarr.recently-switched`
 * entre l'en-tête et le démarrage).
 *
 * SESSIONSTORAGE, ET PAS localStorage — l'inverse du choix fait pour le PORTEUR
 * d'invitation, et pour la raison inverse. Le porteur doit survivre à la
 * fermeture de l'onglet imposée par la vérification d'e-mail ; ce repère-ci, non.
 * C'est une commodité d'un instant : s'il se perd, le champ s'ouvre vide, comme
 * avant. Le garder durablement ferait au contraire pré-remplir, des jours plus
 * tard, une connexion qui n'a rien à voir — avec l'adresse d'un tiers, sur un
 * poste partagé.
 *
 * ET IL SE CONSOMME À LA LECTURE, avec une péremption courte par-dessus : le
 * repère sert UNE fois, celle qu'on vient de demander.
 */

const STORAGE_KEY = 'filarr.invite-signin-hint';

/**
 * Trente minutes : largement plus que le trajet le plus long (déconnexion,
 * verrouillage, retour au sélecteur, assistant d'ajout de compte), et bien moins
 * qu'une session de travail. Au-delà, le repère ne décrit plus une intention
 * courante mais un souvenir, et pré-remplir sur un souvenir est une surprise.
 */
const HINT_TTL_MS = 30 * 60 * 1000;

interface StoredHint {
  email: string;
  savedAt: number;
}

function store(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch {
    /* stockage de session refusé (navigation privée, cookies bloqués) */
  }
  return null;
}

/**
 * Retient l'adresse que le prochain formulaire de connexion devrait proposer.
 *
 * Une adresse vide EFFACE le repère plutôt que d'en écrire un creux : c'est ce
 * qu'un appelant qui n'a pas obtenu l'aperçu doit pouvoir faire sans cas
 * particulier.
 */
export function setInviteSignInHint(email: string | null | undefined): void {
  const s = store();
  if (!s) return;
  const value = (email ?? '').trim();
  try {
    if (!value) {
      s.removeItem(STORAGE_KEY);
      return;
    }
    const hint: StoredHint = { email: value, savedAt: Date.now() };
    s.setItem(STORAGE_KEY, JSON.stringify(hint));
  } catch {
    /* pas de repère : le champ s'ouvrira vide, ce qui est l'ancien comportement */
  }
}

/**
 * Rend l'adresse mise de côté, et l'OUBLIE — le repère sert une fois.
 *
 * Ne jette jamais et ne rend jamais autre chose qu'une chaîne : ce que lit un
 * formulaire au montage ne doit pas pouvoir l'empêcher de s'afficher.
 */
export function takeInviteSignInHint(): string | null {
  const s = store();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(STORAGE_KEY);
    s.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHint>;
    if (typeof parsed?.email !== 'string' || !parsed.email) return null;
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (Date.now() - savedAt > HINT_TTL_MS) return null;
    return parsed.email;
  } catch {
    return null;
  }
}

/** Oublie le repère sans le lire (changement d'avis, écran refermé). */
export function clearInviteSignInHint(): void {
  setInviteSignInHint(null);
}
