/**
 * Vrai quand le renderer tourne dans un NAVIGATEUR sur le dispatcher web
 * (marqueur posé par src/platform/web/installWebPlatform.ts), faux sous
 * Electron. À n'utiliser que pour les rares écarts d'UI assumés du dossier
 * avant-projet web (ex. la case « Rester déverrouillé », qui n'a pas de sens
 * sur desktop où safeStorage restaure la FEK silencieusement).
 */
export function isWebPlatform(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as { __FILARR_WEB__?: boolean }).__FILARR_WEB__ === true
  );
}
