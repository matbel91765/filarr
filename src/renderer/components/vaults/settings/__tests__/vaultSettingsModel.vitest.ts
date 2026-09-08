/**
 * vaultSettingsModel — les décisions de l'onglet « Réglages » (F13), plus la
 * fiche d'identité et la conservation légale de F19.
 *
 * CE QUE CES TESTS GARDENT, ET POURQUOI CHACUN A COÛTÉ QUELQUE CHOSE :
 *
 *  · le CORRECTIF PARTIEL — envoyer le document entier remettrait au défaut les
 *    champs qu'une version plus récente aurait ajoutés, sans que personne ne
 *    l'ait demandé ; un correctif VIDE se fait refuser 400 par le serveur, donc
 *    le bouton doit s'éteindre plutôt que l'envoyer ;
 *  · le BLOC CHIFFRÉ — il est scellé sous K_vault et le serveur ne l'ouvre
 *    jamais ; un décodeur qui LÈVE sur un JSON d'une version future ferme
 *    l'onglet entier, et un encodeur qui OUBLIE les champs qu'il ne connaît pas
 *    (l'apparence de F14, la règle OOB de F25) les efface au premier
 *    enregistrement fait par un client plus ancien ;
 *  · l'ÉPOQUE DU SCELLÉ — un bloc scellé sous une clé révolue ne s'ouvre plus ;
 *    afficher du vide ferait croire à une description effacée, alors qu'il
 *    suffit de la ré-enregistrer ; encore faut-il que ce geste EXISTE (le
 *    rescellement forcé : à texte inchangé, les deux encodages sont
 *    identiques et le bouton resterait éteint pour toujours) et qu'il soit
 *    REFUSÉ sur un bloc que cet appareil n'a pas su ouvrir — sceller un champ
 *    vide par-dessus effacerait ce qu'un autre membre lit encore ;
 *  · le PLAFOND D'EXPIRATION — un plafond posé rend l'expiration OBLIGATOIRE
 *    côté serveur (un accès sans fin le contournerait) : proposer « jamais »
 *    sous un plafond, c'est promettre un geste qui sera refusé ;
 *  · la CONSERVATION LÉGALE — le champ est ABSENT sous le rang admin, et absent
 *    ne vaut pas « il n'y en a pas ».
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultSettingsModel.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  DEFAULT_VAULT_SETTINGS,
  INVITE_TTL_CHOICES,
  MAX_GRANT_EXPIRY_DAYS,
  MAX_INVITE_TTL_DAYS,
  MAX_RETAINED_REVISIONS,
  MAX_STORAGE_CAP_BYTES,
  MAX_VAULT_DESCRIPTION,
  MAX_VAULT_ITEM_ID,
  MIN_INVITE_TTL_DAYS,
  MIN_RETAINED_REVISIONS,
  TRASH_RETENTION_CHOICES,
  VAULT_INVITE_ROLES,
  VAULT_SETTINGS_BLOCK_VERSION,
  clampGrantMaxExpiryDays,
  coerceGrantExpiry,
  dangerGuard,
  decodeVaultSettingsBlock,
  encodeVaultSettingsBlock,
  formatStorageCapGb,
  grantExpiryChoices,
  inviteTtlChoices,
  parseStorageCapGb,
  readVaultSettings,
  settingsBlockNotice,
  settingsSealVerdict,
  storageCapUsage,
  vaultSettingsSavePlan,
  vaultSpaceIdentity,
  type VaultSettingsDocument,
} from '../vaultSettingsModel';

const doc = (over: Partial<VaultSettingsDocument> = {}): VaultSettingsDocument => ({
  ...DEFAULT_VAULT_SETTINGS,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Le document en clair
// ─────────────────────────────────────────────────────────────────────────────

describe('les défauts sont le comportement d’AVANT F13', () => {
  it('sept jours, rôle « membre », accès par élément ouverts et sans plafond', () => {
    // Un coffre sans ligne de réglages doit se comporter exactement comme hier :
    // sinon la migration changerait le sort de tous les coffres existants.
    expect(DEFAULT_VAULT_SETTINGS).toEqual({
      inviteTtlDays: 7,
      defaultInviteRole: 'member',
      itemGrantsEnabled: true,
      grantMaxExpiryDays: null,
      itemDeleteRequiresAdmin: false,
      // F20/F24 : ce que le worker faisait en dur avant que ces trois-là ne
      // deviennent réglables.
      trashRetentionDays: 30,
      retainedRevisions: 3,
      storageCapBytes: null,
      /**
       * F21 — LE SEUL DÉFAUT DE CETTE LISTE QUI N'EST PAS « COMME AVANT ».
       *
       * Tous les autres reproduisent un comportement existant ; la relance
       * automatique, elle, N'EXISTAIT PAS. Son défaut est `true` parce que
       * personne ne peut regretter la disparition d'un comportement qu'il
       * n'avait pas — et parce que l'ABSENCE de rappel est précisément ce qui a
       * coûté un accès (une invitation morte de vieillesse, chez un hôte qui
       * croyait l'avoir donnée). Le worker pose le même défaut : deux valeurs
       * différentes feraient afficher l'inverse de ce que le cron applique.
       */
      autoRemindInvites: true,
    });
  });

  it('les durées proposées à l’écran restent dans les bornes du serveur', () => {
    for (const days of INVITE_TTL_CHOICES) {
      expect(days).toBeGreaterThanOrEqual(MIN_INVITE_TTL_DAYS);
      expect(days).toBeLessThanOrEqual(MAX_INVITE_TTL_DAYS);
    }
    // Le défaut doit être proposable, sinon l'écran ne sait pas afficher l'état
    // d'un coffre qui n'a jamais été réglé.
    expect(INVITE_TTL_CHOICES).toContain(DEFAULT_VAULT_SETTINGS.inviteTtlDays);
  });

  it('« propriétaire » n’est pas un rôle d’invitation : la propriété se transfère', () => {
    expect(VAULT_INVITE_ROLES).not.toContain('owner');
  });
});

describe('inviteTtlChoices — le menu doit savoir afficher ce que le coffre porte', () => {
  it('ne change rien quand la valeur du coffre est déjà proposée', () => {
    expect(inviteTtlChoices([7])).toEqual([...INVITE_TTL_CHOICES]);
    expect(inviteTtlChoices([])).toEqual([...INVITE_TTL_CHOICES]);
  });

  it('INJECTE la valeur enregistrée quand aucun palier ne tombe dessus', () => {
    // Le défaut trouvé en relecture : un coffre réglé à 21 jours par un autre
    // client affichait un menu VIDE — le champ mentait sur l'état du coffre.
    expect(inviteTtlChoices([21])).toEqual([1, 3, 7, 14, 21, 30]);
  });

  it('garde le RANG de l’enregistré ET celui du brouillon, sans doublon', () => {
    // Sinon choisir 7 dans un coffre réglé à 21 ferait disparaître 21 du menu,
    // et « Réinitialiser » proposerait une valeur que le menu ne sait plus dire.
    expect(inviteTtlChoices([21, 2])).toEqual([1, 2, 3, 7, 14, 21, 30]);
    expect(inviteTtlChoices([21, 21])).toEqual([1, 3, 7, 14, 21, 30]);
  });

  it('n’injecte JAMAIS ce que le serveur refuserait', () => {
    // Proposer 0, 99 ou 7,5 offrirait un bouton qui ne peut que se faire refuser.
    expect(inviteTtlChoices([0, 99, 7.5, Number.NaN])).toEqual([...INVITE_TTL_CHOICES]);
  });

  it('ne RETIRE jamais un palier', () => {
    for (const days of INVITE_TTL_CHOICES) {
      expect(inviteTtlChoices([21])).toContain(days);
    }
  });
});

describe('readVaultSettings — une lecture ne lève JAMAIS', () => {
  it('rend les défauts sur n’importe quoi', () => {
    for (const raw of [undefined, null, 42, 'oui', [], { inviteTtlDays: 'sept' }]) {
      expect(readVaultSettings(raw)).toEqual(DEFAULT_VAULT_SETTINGS);
    }
  });

  it('garde ce qui est valide et retombe champ par champ sur le reste', () => {
    expect(
      readVaultSettings({
        inviteTtlDays: 14,
        defaultInviteRole: 'roi', // inconnu → défaut
        itemGrantsEnabled: false,
        grantMaxExpiryDays: 9999, // hors borne → défaut (aucun plafond)
        itemDeleteRequiresAdmin: true,
      })
    ).toEqual({
      inviteTtlDays: 14,
      defaultInviteRole: 'member',
      itemGrantsEnabled: false,
      grantMaxExpiryDays: null,
      itemDeleteRequiresAdmin: true,
      trashRetentionDays: 30,
      retainedRevisions: 3,
      storageCapBytes: null,
      autoRemindInvites: true,
    });
  });

  it('« aucun plafond » est une valeur LÉGITIME, pas une valeur illisible', () => {
    expect(readVaultSettings({ grantMaxExpiryDays: null }).grantMaxExpiryDays).toBeNull();
    expect(readVaultSettings({ grantMaxExpiryDays: 30 }).grantMaxExpiryDays).toBe(30);
  });

  it('une clé inconnue d’une version future ne casse rien', () => {
    expect(readVaultSettings({ inviteTtlDays: 3, membersCanInvite: true })).toEqual(
      doc({ inviteTtlDays: 3 })
    );
  });

  /**
   * F21 — LA RELANCE AUTOMATIQUE, ET POURQUOI ELLE NE PEUT PAS ÊTRE LUE COMME
   * LES AUTRES BOOLÉENS.
   *
   * Son défaut est `true` : lire une valeur illisible (ou l'absence du champ,
   * sur un coffre d'avant 0078) comme `false` ÉTEINDRAIT à l'écran un rappel
   * que le cron envoie quand même — l'hôte croirait alors devoir relancer à la
   * main, et tuerait un lien encore valide pour rien. Un `??` sur un booléen
   * dont le défaut est vrai est exactement le piège que ce test ferme.
   */
  it('autoRemindInvites : `false` se lit, l’absence et l’illisible retombent sur VRAI', () => {
    expect(readVaultSettings({ autoRemindInvites: false }).autoRemindInvites).toBe(false);
    expect(readVaultSettings({ autoRemindInvites: true }).autoRemindInvites).toBe(true);
    expect(readVaultSettings({}).autoRemindInvites).toBe(true);
    expect(readVaultSettings({ autoRemindInvites: 'non' }).autoRemindInvites).toBe(true);
    expect(readVaultSettings({ autoRemindInvites: 0 }).autoRemindInvites).toBe(true);
  });
});

describe('clampGrantMaxExpiryDays — la saisie est bornée AVANT l’envoi', () => {
  it('vide vaut « aucun plafond »', () => {
    expect(clampGrantMaxExpiryDays(null)).toBeNull();
    expect(clampGrantMaxExpiryDays(Number.NaN)).toBeNull();
  });

  it('rabat dans [1, 365] plutôt que d’envoyer un 400 au serveur', () => {
    expect(clampGrantMaxExpiryDays(0)).toBe(1);
    expect(clampGrantMaxExpiryDays(-5)).toBe(1);
    expect(clampGrantMaxExpiryDays(10_000)).toBe(MAX_GRANT_EXPIRY_DAYS);
    expect(clampGrantMaxExpiryDays(30.7)).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Le plan d'enregistrement
// ─────────────────────────────────────────────────────────────────────────────

describe('vaultSettingsSavePlan — ce qui part, et rien de plus', () => {
  const saved = { settings: doc(), block: { description: '' } };

  it('rien touché : rien à enregistrer (le serveur refuse 400 une écriture vide)', () => {
    const plan = vaultSettingsSavePlan(saved, { settings: doc(), block: { description: '' } });
    expect(plan.empty).toBe(true);
    expect(plan.patch).toBeNull();
    expect(plan.block).toBeNull();
    expect(plan.sections).toEqual([]);
  });

  it('le correctif est PARTIEL : un seul champ changé, un seul champ envoyé', () => {
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc({ inviteTtlDays: 14 }),
      block: { description: '' },
    });
    expect(plan.patch).toEqual({ inviteTtlDays: 14 });
    expect(plan.empty).toBe(false);
    expect(plan.sections).toEqual(['invitations']);
  });

  it('« aucun plafond » → un plafond est un CHANGEMENT, pas une absence', () => {
    // `null` ne se distingue pas d'« absent » par un `??` : le piège du champ.
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc({ grantMaxExpiryDays: 30 }),
      block: { description: '' },
    });
    expect(plan.patch).toEqual({ grantMaxExpiryDays: 30 });
    const retour = vaultSettingsSavePlan(
      { settings: doc({ grantMaxExpiryDays: 30 }), block: { description: '' } },
      { settings: doc({ grantMaxExpiryDays: null }), block: { description: '' } }
    );
    expect(retour.patch).toEqual({ grantMaxExpiryDays: null });
  });

  it('les sections sont NOMMÉES, dans un ordre stable, sans doublon', () => {
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc({ inviteTtlDays: 1, defaultInviteRole: 'viewer', itemGrantsEnabled: false }),
      block: { description: 'Contrats 2026' },
    });
    expect(plan.sections).toEqual(['invitations', 'permissions', 'app']);
  });

  it('F21 : couper la relance automatique part SEULE, et dans la section « invitations »', () => {
    // La même section que côté worker (`SECTION_OF` de vaultSettings.ts) : le
    // journal d'audit dit dans QUELLE partie quelque chose a changé, et deux
    // vocabulaires produiraient une ligne que l'écran ne sait pas relire.
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc({ autoRemindInvites: false }),
      block: { description: '' },
    });
    expect(plan.patch).toEqual({ autoRemindInvites: false });
    expect(plan.sections).toEqual(['invitations']);
  });

  it('la description seule ne fait PAS de correctif en clair', () => {
    // Rien de nominatif ne part au serveur en clair : la description vit dans le
    // bloc scellé, et le `patch` doit rester nul.
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc(),
      block: { description: 'Le coffre des contrats' },
    });
    expect(plan.patch).toBeNull();
    expect(plan.block).toEqual({ description: 'Le coffre des contrats' });
    expect(plan.sections).toEqual(['app']);
  });

  it('la description est BORNÉE avant d’être scellée', () => {
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc(),
      block: { description: 'x'.repeat(MAX_VAULT_DESCRIPTION + 50) },
    });
    expect(plan.block?.description).toHaveLength(MAX_VAULT_DESCRIPTION);
  });

  it('VIDER la description est un enregistrement, pas un silence', () => {
    // Le défaut trouvé en écrivant l'écran : avec un encodeur qui rendait
    // « rien » pour un bloc vide, vider le champ puis cliquer Enregistrer ne
    // faisait RIEN, et le texte revenait au rechargement suivant.
    const plan = vaultSettingsSavePlan(
      { settings: doc(), block: { description: 'Contrats' } },
      { settings: doc(), block: { description: '' } }
    );
    expect(plan.empty).toBe(false);
    expect(plan.block).not.toBeNull();
    expect(plan.sections).toEqual(['app']);
  });

  it('un coffre sans bloc et un champ laissé vide n’écrivent rien', () => {
    // L'autre moitié de la même règle : ne JAMAIS consommer une version pour un
    // bloc qui n'a jamais existé et qu'on n'a pas rempli — cela ferait échouer
    // le compare-and-set d'un voisin pour rien.
    const plan = vaultSettingsSavePlan(
      { settings: doc(), block: { description: '' } },
      { settings: doc(), block: { description: '' } }
    );
    expect(plan.empty).toBe(true);
    expect(plan.block).toBeNull();
  });

  it('une description dont seuls les espaces changent ne rescelle rien', () => {
    const plan = vaultSettingsSavePlan(
      { settings: doc(), block: { description: 'Contrats' } },
      { settings: doc(), block: { description: '  Contrats  ' } }
    );
    expect(plan.block).toBeNull();
    expect(plan.empty).toBe(true);
  });
});

describe('le rescellement FORCÉ — le geste que l’écran promet doit exister', () => {
  const saved = { settings: doc(), block: { description: 'Contrats' } };

  it('sans lui, « ré-enregistrez pour resceller » ne peut PAS se faire', () => {
    // Le défaut trouvé en revue : l'avertissement « ce bloc est scellé sous une
    // clé révolue, ré-enregistrez-le » nomme un geste impossible. Le plan compare
    // deux ENCODAGES ; à description inchangée ils sont identiques, donc le
    // bouton Enregistrer reste éteint et le bloc reste scellé sous la clé
    // retirée — illisible pour tout membre arrivé après la rotation.
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc(),
      block: { description: 'Contrats' },
    });
    expect(plan.empty).toBe(true);
    expect(plan.block).toBeNull();
  });

  it('avec lui, le bloc repart TEL QUEL, et le bouton s’allume', () => {
    const plan = vaultSettingsSavePlan(
      saved,
      { settings: doc(), block: { description: 'Contrats' } },
      { forceReseal: true }
    );
    expect(plan.empty).toBe(false);
    expect(plan.block).toEqual({ description: 'Contrats' });
    expect(plan.sections).toEqual(['app']);
    // Resceller ne touche RIEN en clair : le correctif reste nul.
    expect(plan.patch).toBeNull();
  });

  it('les champs PORTÉS traversent le rescellement intacts', () => {
    // Resceller est justement le moment où un client d'aujourd'hui réécrit un
    // bloc qu'une version plus récente a rempli (l'apparence de F14, la règle
    // OOB de F25) : les perdre ici les perdrait pour tous les membres.
    const bloc = { description: 'Contrats', carried: { requireOob: true } };
    const plan = vaultSettingsSavePlan(
      { settings: doc(), block: bloc },
      { settings: doc(), block: bloc },
      { forceReseal: true }
    );
    expect(plan.block?.carried).toEqual({ requireOob: true });
  });

  it('il s’AJOUTE au correctif en clair, il ne le remplace pas', () => {
    const plan = vaultSettingsSavePlan(
      saved,
      { settings: doc({ inviteTtlDays: 14 }), block: { description: 'Contrats' } },
      { forceReseal: true }
    );
    expect(plan.patch).toEqual({ inviteTtlDays: 14 });
    expect(plan.sections).toEqual(['invitations', 'app']);
  });

  it('faux ou absent ne change rien à la règle ordinaire', () => {
    const plan = vaultSettingsSavePlan(
      saved,
      { settings: doc(), block: { description: 'Contrats' } },
      { forceReseal: false }
    );
    expect(plan.empty).toBe(true);
    expect(plan.block).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Le bloc chiffré
// ─────────────────────────────────────────────────────────────────────────────

describe('le bloc chiffré — un décodeur qui ne lève jamais, un encodeur qui n’efface rien', () => {
  it('décode ce qu’il connaît', () => {
    const json = JSON.stringify({ v: 1, description: 'Contrats' });
    expect(decodeVaultSettingsBlock(json).description).toBe('Contrats');
  });

  it('ne LÈVE sur rien — un onglet fermé coûte plus qu’une description perdue', () => {
    for (const raw of ['', '{', 'null', '[]', '"texte"', undefined, null]) {
      expect(() => decodeVaultSettingsBlock(raw)).not.toThrow();
      expect(decodeVaultSettingsBlock(raw).description).toBe('');
    }
  });

  it('une version future se lit sans être comprise, et sans casser', () => {
    const json = JSON.stringify({ v: 99, description: 'Contrats', appearance: { emoji: '📁' } });
    expect(decodeVaultSettingsBlock(json).description).toBe('Contrats');
  });

  it('GARDE les champs qu’il ne connaît pas — F14 et F25 les rempliront', () => {
    // Un client d'aujourd'hui qui rescelle le bloc EFFACERAIT l'apparence posée
    // par un client plus récent. C'est le défaut le plus cher de tout le lot :
    // il ne se voit qu'une fois la fiche suivante livrée, chez quelqu'un d'autre.
    const json = JSON.stringify({
      v: 1,
      description: 'Contrats',
      appearance: { emoji: '📁', color: 'terracotta' },
      requireOob: true,
    });
    const block = decodeVaultSettingsBlock(json);
    const rescellé = JSON.parse(encodeVaultSettingsBlock(block));
    expect(rescellé.appearance).toEqual({ emoji: '📁', color: 'terracotta' });
    expect(rescellé.requireOob).toBe(true);
    expect(rescellé.description).toBe('Contrats');
  });

  it('encode en v1, et une description vide reste un bloc — sinon on ne peut plus l’effacer', () => {
    expect(JSON.parse(encodeVaultSettingsBlock({ description: 'Contrats' })).v).toBe(
      VAULT_SETTINGS_BLOCK_VERSION
    );
    // Le piège : rendre « rien » pour un champ vidé rendait l'EFFACEMENT
    // impossible — on vidait, on enregistrait, rien ne partait, et le texte
    // revenait au rechargement. Une enveloppe scellée dit « pas de description ».
    const vide = JSON.parse(encodeVaultSettingsBlock({ description: '   ' }));
    expect(vide).toEqual({ v: VAULT_SETTINGS_BLOCK_VERSION });
    expect(decodeVaultSettingsBlock(JSON.stringify(vide)).description).toBe('');
  });

  it('vider la description ne perd PAS les champs d’une version plus récente', () => {
    const block = decodeVaultSettingsBlock(
      JSON.stringify({ v: 1, description: 'Contrats', requireOob: true })
    );
    const rescellé = JSON.parse(encodeVaultSettingsBlock({ ...block, description: '' }));
    expect(rescellé.requireOob).toBe(true);
    expect('description' in rescellé).toBe(false);
  });
});

describe('le bloc chiffré — `pinnedItemId` (F27), nommé et borné', () => {
  it('un identifiant d’élément se lit, se rabote et se rescelle', () => {
    const json = JSON.stringify({ v: 1, description: 'Contrats', pinnedItemId: '  i-1  ' });
    const block = decodeVaultSettingsBlock(json);
    expect(block.pinnedItemId).toBe('i-1');
    expect(JSON.parse(encodeVaultSettingsBlock(block)).pinnedItemId).toBe('i-1');
  });

  it('BORNÉ : ce qui n’est pas un identifiant d’élément n’entre pas', () => {
    // Le champ ne porte QU'UN identifiant. Un objet, un tableau, un nombre ou
    // une chaîne interminable rangés là par une main ou par une version future
    // finiraient dans une route (`?item=…`) et dans une comparaison d'ensemble :
    // on les laisse dehors plutôt que de les propager.
    for (const raw of [{ id: 'i-1' }, ['i-1'], 42, true, null]) {
      expect(
        decodeVaultSettingsBlock(JSON.stringify({ v: 1, pinnedItemId: raw })).pinnedItemId
      ).toBeUndefined();
    }
    const trop = 'x'.repeat(MAX_VAULT_ITEM_ID + 40);
    expect(
      decodeVaultSettingsBlock(JSON.stringify({ v: 1, pinnedItemId: trop })).pinnedItemId
    ).toBeUndefined();
  });

  it('DÉSÉPINGLER efface le champ, sans toucher au reste du bloc', () => {
    const block = decodeVaultSettingsBlock(
      JSON.stringify({ v: 1, description: 'Contrats', pinnedItemId: 'i-1', requireOob: true })
    );
    const rescellé = JSON.parse(encodeVaultSettingsBlock({ ...block, pinnedItemId: undefined }));
    expect('pinnedItemId' in rescellé).toBe(false);
    expect(rescellé.description).toBe('Contrats');
    expect(rescellé.requireOob).toBe(true);
  });

  it('épingler fait un plan d’enregistrement, et il ne porte QUE la section « app »', () => {
    // Le champ vit dans le bloc scellé : il ne touche aucun réglage en clair, et
    // le correctif partiel doit rester vide — sinon un `PUT` sans changement de
    // réglage repartirait avec un patch que le serveur n'a pas demandé.
    const saved = { settings: doc(), block: { description: 'Contrats' } };
    const suivant = {
      settings: doc(),
      block: { description: 'Contrats', pinnedItemId: 'i-1' },
    };
    const plan = vaultSettingsSavePlan(saved, suivant);
    expect(plan.empty).toBe(false);
    expect(plan.patch).toBeNull();
    expect(plan.block?.pinnedItemId).toBe('i-1');
    expect(plan.sections).toEqual(['app']);
  });

  it('UN CHAMP INCONNU DU BLOC SURVIT À L’ENREGISTREMENT D’UNE ÉPINGLE', () => {
    // Le défaut le plus cher du bloc chiffré : un client qui épingle et
    // rescelle EFFACERAIT ce qu'une version plus récente y a posé. Il ne se voit
    // jamais chez celui qui le provoque, seulement chez les autres membres.
    const saved = {
      settings: doc(),
      block: decodeVaultSettingsBlock(
        JSON.stringify({ v: 1, description: 'Contrats', requireOob: true, futur: { a: 1 } })
      ),
    };
    const suivant = { settings: doc(), block: { ...saved.block, pinnedItemId: 'i-1' } };
    const plan = vaultSettingsSavePlan(saved, suivant);
    const scellé = JSON.parse(encodeVaultSettingsBlock(plan.block!));
    expect(scellé.requireOob).toBe(true);
    expect(scellé.futur).toEqual({ a: 1 });
    expect(scellé.pinnedItemId).toBe('i-1');
  });
});

describe('settingsSealVerdict — sous quelle clé le bloc a-t-il été scellé', () => {
  it('aucun bloc : rien à dire', () => {
    expect(settingsSealVerdict({ hasBlock: false, settingsEpoch: null, currentKeyEpoch: 3 })).toBe(
      'absent'
    );
  });

  it('scellé sous la clé courante : rien à dire non plus', () => {
    expect(settingsSealVerdict({ hasBlock: true, settingsEpoch: 3, currentKeyEpoch: 3 })).toBe(
      'current'
    );
  });

  it('scellé sous une clé RÉVOLUE : le dire, ne pas afficher du vide', () => {
    expect(settingsSealVerdict({ hasBlock: true, settingsEpoch: 2, currentKeyEpoch: 3 })).toBe(
      'superseded'
    );
  });

  it('une époque manquante (vieux worker) se traite comme révolue', () => {
    // On ne sait pas sous quelle clé il a été scellé : le supposer courant ferait
    // afficher du vide en promettant qu'il n'y a rien à réparer.
    expect(settingsSealVerdict({ hasBlock: true, settingsEpoch: null, currentKeyEpoch: 2 })).toBe(
      'superseded'
    );
  });
});

describe('settingsBlockNotice — « à resceller » et « je n’ai pas su l’ouvrir » ne s’excluent pas', () => {
  it('clé révolue mais bloc LU : le rescellement est proposé, et lui seul', () => {
    expect(
      settingsBlockNotice({ seal: 'superseded', blockReadable: true, hasStoredBlock: true })
    ).toEqual({ reseal: true, unreadable: false, pending: false });
  });

  it('clé révolue ET bloc illisible : on AVERTIT, on ne propose pas de resceller', () => {
    // Le défaut trouvé en revue : les deux verdicts tombaient ensemble (un bloc
    // sans époque, ou dont la clé manque à cet appareil), et l'écran ne montrait
    // que « ré-enregistrez ». Suivre ce conseil scellait un texte JAMAIS LU
    // par-dessus celui qu'un autre membre sait encore ouvrir.
    expect(
      settingsBlockNotice({ seal: 'superseded', blockReadable: false, hasStoredBlock: true })
    ).toEqual({ reseal: false, unreadable: true, pending: false });
  });

  it('aucun bloc enregistré : rien à dire, même si rien n’a été lu', () => {
    // « Pas de description » et « je n'ai pas su la lire » sont deux écrans vides
    // identiques et deux gestes opposés.
    expect(
      settingsBlockNotice({ seal: 'absent', blockReadable: true, hasStoredBlock: false })
    ).toEqual({ reseal: false, unreadable: false, pending: false });
  });

  it('bloc courant et lisible : rien à dire non plus', () => {
    expect(
      settingsBlockNotice({ seal: 'current', blockReadable: true, hasStoredBlock: true })
    ).toEqual({ reseal: false, unreadable: false, pending: false });
  });

  /**
   * UNE LECTURE EN VOL N'EST PAS UN VERDICT D'ILLISIBILITÉ.
   *
   * Le chargeur pose `stored` (la ligne du serveur) AVANT d'avoir déchiffré le
   * bloc : entre les deux, `hasStoredBlock` est vrai et `blockReadable` porte
   * encore la valeur du tour PRÉCÉDENT. Sur une relecture qui suit un bloc
   * illisible — exactement le cas où l'on vient de déverrouiller le coffre et où
   * la lecture va RÉUSSIR — épingler dans cette fenêtre-là répondait « bloc
   * illisible », alors que la vérité était « patientez ».
   *
   * LE REFUS NE CHANGE PAS, et c'est important : on n'écrit toujours PAS par
   * dessus un bloc qu'on n'a pas su ouvrir (ce serait effacer, pour tous les
   * membres, une description qu'un autre appareil lit encore). Seule la PHRASE
   * change. `pending` ne qualifie donc jamais qu'un `unreadable` : il dit que ce
   * verdict-ci n'est pas définitif, pas qu'il faut passer outre.
   */
  it('lecture EN VOL : illisible reste vrai, mais le verdict se dit « pas encore »', () => {
    expect(
      settingsBlockNotice({
        seal: 'current',
        blockReadable: false,
        hasStoredBlock: true,
        loading: true,
      })
    ).toEqual({ reseal: false, unreadable: true, pending: true });
  });

  it('« pas encore » ne qualifie QUE l’illisibilité — jamais un bloc lu', () => {
    // Un chargement en cours sur un bloc parfaitement lu ne dit rien du tout :
    // sans cette borne, l'écran dirait « patientez » à chaque relecture.
    expect(
      settingsBlockNotice({
        seal: 'current',
        blockReadable: true,
        hasStoredBlock: true,
        loading: true,
      })
    ).toEqual({ reseal: false, unreadable: false, pending: false });
    // Et sans bloc enregistré, il n'y a rien à attendre non plus.
    expect(
      settingsBlockNotice({
        seal: 'absent',
        blockReadable: false,
        hasStoredBlock: false,
        loading: true,
      })
    ).toEqual({ reseal: false, unreadable: false, pending: false });
  });

  it('l’appelant qui ne dit rien du chargement obtient l’ancien comportement', () => {
    // `loading` est optionnel : les écrans qui n'ont pas la notion (l'onglet
    // Réglages lit déjà son propre état) ne changent pas de phrase.
    expect(
      settingsBlockNotice({ seal: 'current', blockReadable: false, hasStoredBlock: true }).pending
    ).toBe(false);
  });

  it('un bloc qu’on n’a pas su ouvrir ne part JAMAIS — les deux décisions ensemble', () => {
    // L'interaction que rien ne gardait : le verdict du scellé COMMANDE le
    // rescellement forcé. Illisible ⇒ pas de rescellement ⇒ le correctif en clair
    // part seul, et le couple enregistré reste celui que ses lecteurs ouvrent.
    const notice = settingsBlockNotice({
      seal: 'superseded',
      blockReadable: false,
      hasStoredBlock: true,
    });
    const plan = vaultSettingsSavePlan(
      { settings: doc(), block: { description: '' } },
      { settings: doc({ inviteTtlDays: 14 }), block: { description: '' } },
      { forceReseal: notice.reseal }
    );
    expect(plan.block).toBeNull();
    expect(plan.patch).toEqual({ inviteTtlDays: 14 });
    expect(plan.sections).toEqual(['invitations']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ce que le partage par élément a le droit de proposer
// ─────────────────────────────────────────────────────────────────────────────

describe('grantExpiryChoices — un plafond rend l’expiration OBLIGATOIRE', () => {
  it('sans plafond : jamais / 7 j / 30 j, comme avant F13', () => {
    expect(grantExpiryChoices(null)).toEqual([null, 7, 30]);
  });

  it('sous plafond, « jamais » disparaît — le serveur le refuserait', () => {
    expect(grantExpiryChoices(30)).toEqual([7, 30]);
    expect(grantExpiryChoices(14)).toEqual([7, 14]);
  });

  it('un plafond serré ne propose QUE lui', () => {
    expect(grantExpiryChoices(3)).toEqual([3]);
    expect(grantExpiryChoices(1)).toEqual([1]);
  });

  it('un plafond large garde les paliers ET la borne', () => {
    expect(grantExpiryChoices(365)).toEqual([7, 30, 365]);
  });

  it('coerceGrantExpiry ramène un choix devenu illégal dans le plafond', () => {
    expect(coerceGrantExpiry(null, null)).toBeNull();
    expect(coerceGrantExpiry(7, null)).toBe(7);
    // « jamais » sous un plafond : on tombe sur la borne, pas sur un refus.
    expect(coerceGrantExpiry(null, 30)).toBe(30);
    expect(coerceGrantExpiry(7, 30)).toBe(7);
    // Au-delà de la borne : la borne.
    expect(coerceGrantExpiry(30, 14)).toBe(14);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F19 — l'espace du coffre, son plan, et la conservation légale
// ─────────────────────────────────────────────────────────────────────────────

describe('vaultSpaceIdentity — nommer l’espace sans rien inventer', () => {
  const orgs = [{ id: 'org1', name: 'Espace de Camille' }];

  it('nomme l’espace quand on le connaît', () => {
    const id = vaultSpaceIdentity({ organizationId: 'org1', orgs, planRefused: false });
    expect(id.label).toBe('Espace de Camille');
    expect(id.named).toBe(true);
  });

  it('retombe sur l’identifiant, et le DIT, quand on ne le connaît pas', () => {
    const id = vaultSpaceIdentity({ organizationId: 'org9', orgs, planRefused: false });
    expect(id.label).toBe('org9');
    expect(id.named).toBe(false);
  });

  it('le plan n’est « échu » que lorsqu’on a VU le refus', () => {
    // Le serveur ne publie l'entitlement d'un espace nulle part : le déduire du
    // tier ou du statut de facturation serait un verdict que le worker ne calcule
    // pas ainsi. Sans refus observé, on ne dit rien.
    expect(vaultSpaceIdentity({ organizationId: 'org1', orgs, planRefused: false }).plan).toBe(
      'unknown'
    );
    expect(vaultSpaceIdentity({ organizationId: 'org1', orgs, planRefused: true }).plan).toBe(
      'lapsed'
    );
  });
});

describe('dangerGuard — la conservation légale ferme les gestes, et le dit', () => {
  it('vrai : les gestes irréversibles sont fermés', () => {
    expect(dangerGuard(true)).toBe('legalHold');
  });

  it('ABSENT ne vaut pas « il n’y en a pas » — mais ne ferme rien non plus', () => {
    // Le champ n'est servi qu'au rang admin : en dessous, on ne sait pas. On ne
    // grise donc rien (le serveur refusera, avec sa phrase), et surtout on
    // n'affirme pas qu'il n'y a pas de conservation.
    expect(dangerGuard(undefined)).toBe('none');
    expect(dangerGuard(false)).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F20 / F24 — la conservation et le plafond de stockage
// ─────────────────────────────────────────────────────────────────────────────

describe('readVaultSettings — les trois champs de F20/F24', () => {
  it('les défauts sont le comportement d’AVANT ces fiches', () => {
    // Trente jours de corbeille, trois révisions retenues, aucun plafond : ce que
    // `vaults.ts` faisait en dur. Un coffre qui n'a jamais rien réglé ne doit pas
    // changer de sort le jour où l'écran gagne des curseurs.
    expect(DEFAULT_VAULT_SETTINGS.trashRetentionDays).toBe(30);
    expect(DEFAULT_VAULT_SETTINGS.retainedRevisions).toBe(3);
    expect(DEFAULT_VAULT_SETTINGS.storageCapBytes).toBeNull();
  });

  it('lit ce que le serveur a écrit', () => {
    const s = readVaultSettings({
      trashRetentionDays: 7,
      retainedRevisions: 10,
      storageCapBytes: 5 * BYTES_PER_GB,
    });
    expect(s.trashRetentionDays).toBe(7);
    expect(s.retainedRevisions).toBe(10);
    expect(s.storageCapBytes).toBe(5 * BYTES_PER_GB);
  });

  it('une durée HORS ÉNUMÉRATION retombe sur le défaut — comme le serveur', () => {
    // Le balayage compare la valeur stockée à cette même liste avant de s'en
    // servir : afficher « 21 jours » promettrait une durée que le serveur
    // n'applique pas.
    expect(readVaultSettings({ trashRetentionDays: 21 }).trashRetentionDays).toBe(30);
    expect(readVaultSettings({ trashRetentionDays: '30' }).trashRetentionDays).toBe(30);
    expect(TRASH_RETENTION_CHOICES).toEqual([7, 14, 30, 90]);
  });

  it('un nombre de révisions hors bornes retombe SEUL, sans emporter les voisins', () => {
    const s = readVaultSettings({ retainedRevisions: 99, trashRetentionDays: 14 });
    expect(s.retainedRevisions).toBe(DEFAULT_VAULT_SETTINGS.retainedRevisions);
    expect(s.trashRetentionDays).toBe(14);
    expect(MIN_RETAINED_REVISIONS).toBe(1);
    expect(MAX_RETAINED_REVISIONS).toBe(10);
  });

  it('ZÉRO est un plafond LÉGITIME, et ne se confond pas avec « aucun »', () => {
    // `0` veut dire « plus un octet de plus » — ce qu'un hôte peut vouloir sur un
    // coffre qu'il archive. Seul `null` veut dire « aucun plafond », d'où la
    // borne basse à zéro et le test explicite du `null`.
    expect(readVaultSettings({ storageCapBytes: 0 }).storageCapBytes).toBe(0);
    expect(readVaultSettings({ storageCapBytes: null }).storageCapBytes).toBeNull();
    expect(readVaultSettings({ storageCapBytes: -1 }).storageCapBytes).toBeNull();
    expect(readVaultSettings({ storageCapBytes: 'plein' }).storageCapBytes).toBeNull();
  });
});

describe('vaultSettingsSavePlan — les nouvelles sections voyagent avec leur champ', () => {
  it('la rétention est une section « retention », le plafond une section « storage »', () => {
    const saved = { settings: doc(), block: { description: '' } };
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc({ trashRetentionDays: 7, storageCapBytes: 42 }),
      block: { description: '' },
    });
    expect(plan.patch).toEqual({ trashRetentionDays: 7, storageCapBytes: 42 });
    expect(plan.sections).toEqual(['retention', 'storage']);
  });

  it('un champ INCONNU de cette version ne part jamais dans le correctif', () => {
    // `autoRemindInvites` (F21) vit sur la même ligne et n'est pas édité ici :
    // l'envoyer le remettrait au défaut sans que personne ne l'ait demandé.
    const saved = { settings: doc(), block: { description: '' } };
    const plan = vaultSettingsSavePlan(saved, {
      settings: doc({ trashRetentionDays: 90 }),
      block: { description: '' },
    });
    expect(Object.keys(plan.patch ?? {})).toEqual(['trashRetentionDays']);
  });
});

describe('le plafond de stockage, tel qu’il se tape et tel qu’il se lit', () => {
  it('un champ VIDE veut dire « aucun plafond », pas « zéro octet »', () => {
    expect(parseStorageCapGb('')).toBeNull();
    expect(parseStorageCapGb('   ')).toBeNull();
    expect(parseStorageCapGb('pas un nombre')).toBeNull();
  });

  it('les gigaoctets deviennent des octets, et la saisie est BORNÉE avant de partir', () => {
    expect(parseStorageCapGb('5')).toBe(5 * BYTES_PER_GB);
    // Zéro reste zéro : « plus un octet de plus ».
    expect(parseStorageCapGb('0')).toBe(0);
    // On RABAT plutôt que de refuser : une frappe de trop ne doit pas coûter un
    // aller-retour et un message d'erreur — mais elle ne doit pas non plus
    // arriver telle quelle au serveur.
    expect(parseStorageCapGb('-3')).toBe(0);
    expect(parseStorageCapGb('999999999')).toBe(MAX_STORAGE_CAP_BYTES);
  });

  it('l’aller-retour est stable : ce qui s’affiche est ce qui repartira', () => {
    expect(formatStorageCapGb(null)).toBe('');
    expect(formatStorageCapGb(5 * BYTES_PER_GB)).toBe('5');
    expect(parseStorageCapGb(formatStorageCapGb(12 * BYTES_PER_GB))).toBe(12 * BYTES_PER_GB);
  });

  it('sans plafond, il n’y a RIEN à jauger', () => {
    expect(storageCapUsage({ capBytes: null, usedBytes: 10 })).toBeNull();
  });

  it('la jauge alerte à 80 %, et DIT quand on est déjà au-dessus', () => {
    const cap = 10 * BYTES_PER_GB;
    expect(storageCapUsage({ capBytes: cap, usedBytes: 1 * BYTES_PER_GB })?.tone).toBe('ok');
    expect(storageCapUsage({ capBytes: cap, usedBytes: 8 * BYTES_PER_GB })?.tone).toBe('warning');
    const over = storageCapUsage({ capBytes: cap, usedBytes: 12 * BYTES_PER_GB });
    // Le serveur ACCEPTE un plafond sous l'usage courant (il ne détruit rien) —
    // mais les prochains envois seront refusés, et l'écran doit le dire AVANT
    // d'enregistrer, pas au premier dépôt refusé.
    expect(over?.over).toBe(true);
    expect(over?.tone).toBe('danger');
    // La barre ne dépasse jamais 100 : un remplissage à 120 % n'est pas une jauge.
    expect(over?.pct).toBe(100);
  });

  it('un plafond à ZÉRO est plein dès le premier octet, sans division par zéro', () => {
    expect(storageCapUsage({ capBytes: 0, usedBytes: 0 })?.pct).toBe(100);
    expect(storageCapUsage({ capBytes: 0, usedBytes: 1 })?.over).toBe(true);
  });
});
