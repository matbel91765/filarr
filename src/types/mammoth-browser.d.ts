/**
 * Minimal type surface for mammoth's self-contained browser bundle.
 *
 * We import `mammoth/mammoth.browser` (not `mammoth`) on purpose: it is a
 * pre-bundled browserify UMD whose internal `require()`/`Buffer` references are
 * resolved inside its own closure, so it works in the webpack renderer with no
 * Node polyfills (config-overrides.js adds none).
 */
declare module 'mammoth/mammoth.browser' {
  interface MammothMessage {
    type: string;
    message: string;
  }
  interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }
  interface MammothInput {
    arrayBuffer: ArrayBuffer;
  }
  export function convertToHtml(input: MammothInput, options?: unknown): Promise<MammothResult>;
  export function extractRawText(input: MammothInput): Promise<MammothResult>;
  const mammoth: {
    convertToHtml: typeof convertToHtml;
    extractRawText: typeof extractRawText;
  };
  export default mammoth;
}
