import { describe, it, expect } from 'vitest';
import { parseInviteUri, findProtocolUriInArgv } from '../inviteProtocol';

/**
 * Le lien profond est le SEUL automatisme possible sur le bureau : le renderer
 * charge `app://filarr.app/index.html`, il n'y a aucune URL à lire, et le lien
 * `https://` de l'e-mail ouvre le navigateur — jamais l'application installée.
 * Jusqu'ici `handleProtocolUri` sortait en silence sur tout hôte autre que
 * « reminder », et rien n'émettait de `filarr://invite` : la fonction était
 * absente, pas cassée.
 *
 * L'analyse est ici plutôt que dans main.ts parce que c'est la seule partie qui
 * peut se tromper, et que main.ts n'est pas testable sans lancer Electron.
 */

const TOKEN = 'a'.repeat(64);
const VAULT = '11111111-2222-3333-4444-555555555555';
const ORG = '99999999-8888-7777-6666-555555555555';

describe('parseInviteUri — les deux formes du lien', () => {
  it('lit une invitation d’ESPACE', () => {
    expect(parseInviteUri(`filarr://invite?token=${TOKEN}`)).toEqual({
      kind: 'org',
      token: TOKEN,
    });
  });

  it('lit une invitation de COFFRE, avec l’org de l’hôte', () => {
    expect(parseInviteUri(`filarr://vault-invite?token=${TOKEN}&vault=${VAULT}&org=${ORG}`)).toEqual(
      { kind: 'vault', token: TOKEN, vaultId: VAULT, orgId: ORG }
    );
  });

  it('accepte une invitation de coffre SANS org — les e-mails d’avant n’en portent pas', () => {
    // La jointure sonde alors les locataires connus : un repli correct, et bien
    // meilleur que de refuser un lien parfaitement valide.
    expect(parseInviteUri(`filarr://vault-invite?token=${TOKEN}&vault=${VAULT}`)).toEqual({
      kind: 'vault',
      token: TOKEN,
      vaultId: VAULT,
    });
  });

  it('ignore une org non conforme plutôt que de rejeter le lien entier', () => {
    const parsed = parseInviteUri(`filarr://vault-invite?token=${TOKEN}&vault=${VAULT}&org=pas-un-uuid`);
    expect(parsed).toEqual({ kind: 'vault', token: TOKEN, vaultId: VAULT });
  });

  it('décode les paramètres percent-encodés du lien', () => {
    const parsed = parseInviteUri(`filarr://invite?token=${encodeURIComponent(TOKEN)}`);
    expect(parsed?.token).toBe(TOKEN);
  });

  it('tolère les paramètres dans le désordre et les inconnus', () => {
    expect(parseInviteUri(`filarr://vault-invite?org=${ORG}&x=1&vault=${VAULT}&token=${TOKEN}`)).
      toMatchObject({ kind: 'vault', vaultId: VAULT, orgId: ORG });
  });
});

describe('parseInviteUri — ce qu’il refuse, et pourquoi', () => {
  it('laisse passer les rappels : ils ont leur propre routage', () => {
    expect(parseInviteUri('filarr://reminder?action=open&id=r1')).toBeNull();
  });

  it('refuse un coffre sans identifiant de coffre', () => {
    // Un tel porteur ne pourrait être présenté à aucune route : mieux vaut ne
    // rien armer que d'armer quelque chose qui ne peut pas aboutir.
    expect(parseInviteUri(`filarr://vault-invite?token=${TOKEN}`)).toBeNull();
    expect(parseInviteUri(`filarr://vault-invite?token=${TOKEN}&vault=pas-un-uuid`)).toBeNull();
  });

  it('refuse un jeton absent ou hors format', () => {
    expect(parseInviteUri('filarr://invite')).toBeNull();
    expect(parseInviteUri('filarr://invite?token=')).toBeNull();
    expect(parseInviteUri('filarr://invite?token=trop-court')).toBeNull();
    expect(parseInviteUri(`filarr://invite?token=${'a'.repeat(513)}`)).toBeNull();
    expect(parseInviteUri(`filarr://invite?token=${'a'.repeat(64)}<script>`)).toBeNull();
  });

  it('refuse un autre schéma — un https ne doit pas entrer par cette porte', () => {
    expect(parseInviteUri(`https://app.filarr.com/invite?token=${TOKEN}`)).toBeNull();
    expect(parseInviteUri(`javascript://invite?token=${TOKEN}`)).toBeNull();
  });

  it('ne jette JAMAIS — l’URI vient d’un shell, pas d’un appelant de confiance', () => {
    // Faire tomber le processus principal sur un lien abîmé serait pire que de
    // l'ignorer : l'application ne s'ouvrirait pas du tout.
    for (const bad of ['filarr://', 'filarr://%%%', '', null, undefined, 42, {}]) {
      expect(() => parseInviteUri(bad as unknown)).not.toThrow();
      expect(parseInviteUri(bad as unknown)).toBeNull();
    }
  });
});

describe('findProtocolUriInArgv — l’activation à froid', () => {
  it('trouve l’URI qu’un lancement Windows place dans l’argv', () => {
    // Application FERMÉE : Windows lance un premier processus qui prend le verrou
    // d'instance unique, donc 'second-instance' n'est jamais émis et 'open-url'
    // est macOS seulement. Sans cette lecture, le clic était perdu sans journal —
    // et c'est le cas le plus fréquent : on clique le lien quand l'app est fermée.
    const argv = ['C:\\Program Files\\Filarr\\Filarr.exe', `filarr://invite?token=${TOKEN}`];
    expect(findProtocolUriInArgv(argv)).toBe(`filarr://invite?token=${TOKEN}`);
  });

  it('rend null quand il n’y en a pas', () => {
    expect(findProtocolUriInArgv(['Filarr.exe', '--protect', 'C:\\docs\\a.pdf'])).toBeNull();
    expect(findProtocolUriInArgv([])).toBeNull();
  });

  it('ignore les entrées qui ne sont pas des chaînes', () => {
    expect(findProtocolUriInArgv([null, 42, {}, `filarr://invite?token=${TOKEN}`])).toBe(
      `filarr://invite?token=${TOKEN}`
    );
  });
});
