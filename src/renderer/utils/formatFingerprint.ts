/** Group a hex fingerprint (or safety number) into 4-char blocks for readable, out-of-band
 *  comparison — e.g. "1A2B 3C4D 5E6F …". Shared by the vault-share + escrow OOB-verification UIs. */
export function formatFingerprint(hex: string): string {
  return (hex.match(/.{1,4}/g) ?? [hex]).join(' ').toUpperCase();
}
