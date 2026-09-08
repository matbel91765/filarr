/**
 * Erreurs typées du dispatcher web (ETW-1003).
 *
 * Deux familles distinctes pour que l'appelant — et la CI — sachent si un canal
 * est définitivement hors périmètre navigateur ('desktop') ou simplement pas
 * encore livré à ce palier. Aucun canal ne doit échouer autrement que par l'une
 * de ces deux erreurs ou une erreur métier de son handler.
 */

export class ChannelUnavailableError extends Error {
  readonly code = 'ERR_CHANNEL_UNAVAILABLE';

  constructor(channel: string, reason: string) {
    super(`Canal '${channel}' indisponible sur le web : ${reason}`);
    this.name = 'ChannelUnavailableError';
  }
}

export class ChannelNotImplementedError extends Error {
  readonly code = 'ERR_CHANNEL_NOT_IMPLEMENTED';

  constructor(channel: string, palier?: string) {
    super(
      `Canal '${channel}' pas encore implémenté côté web` +
        (palier ? ` (prévu au palier ${palier})` : '')
    );
    this.name = 'ChannelNotImplementedError';
  }
}
