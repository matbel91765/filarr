/**
 * pdfRangeTransport.ts — a pdf.js-compatible range transport backed by a
 * {@link RangeSource}, so PDFPreview can open a document by range and fetch only
 * the pages actually viewed instead of buffering the whole file in renderer RAM.
 *
 * pdf.js drives ranged loading through a `PDFDataRangeTransport`: the worker calls
 * `requestDataRange(begin, end)` (end EXCLUSIVE) whenever it needs bytes, and the
 * transport answers by calling `onDataRange(begin, chunk)`. Adoption in PDFPreview
 * (owned by the integrate agent, not changed here):
 *
 *   const transport = await createPdfDataRangeTransport(source);
 *   const doc = await pdfjsLib.getDocument({
 *     range: transport,
 *     rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
 *     disableAutoFetch: true,   // don't pre-fetch the whole file
 *     disableStream: true,      // rely on ranged reads only
 *   }).promise;
 *
 * Design: all range bookkeeping lives in {@link PdfRangeController} (pure, fully
 * unit-testable). {@link buildPdfRangeTransport} wires that controller onto an
 * INJECTED transport constructor, so the wiring is testable with a fake base
 * class without a headless pdf.js/DOM. {@link createPdfDataRangeTransport} is the
 * thin production entry point that lazily imports the real pdf.js class.
 */

import type { PDFDataRangeTransport } from 'pdfjs-dist';
import type { RangeSource } from './rangeSource';

/** pdf.js's default range chunk size (64 KiB). Only the requested ranges are fetched. */
export const PDF_RANGE_CHUNK_SIZE = 64 * 1024;

export interface PdfRangeControllerDeps {
  /** Reads the half-open window `[begin, end)` (pdf.js convention). */
  readRange(begin: number, end: number): Promise<Uint8Array>;
  /** Hands a fetched chunk back to pdf.js, keyed by its start offset. */
  deliver(begin: number, chunk: Uint8Array): void;
  /** Reports a failed range read (the loading task should then be aborted). */
  onError?(err: unknown): void;
}

/**
 * Translates pdf.js range requests into {@link RangeSource} reads and delivers the
 * bytes back, faithfully keyed by the requested `begin` (pdf.js matches delivered
 * chunks by their start offset, so the window must NOT be widened/realigned).
 */
export class PdfRangeController {
  private aborted = false;
  private inFlight = 0;

  constructor(private readonly deps: PdfRangeControllerDeps) {}

  /** Number of range reads currently outstanding (useful for tests/diagnostics). */
  get pending(): number {
    return this.inFlight;
  }

  /** Serves a single pdf.js range request `[begin, end)` (end exclusive). */
  request(begin: number, end: number): void {
    if (this.aborted) {
      return;
    }
    this.inFlight += 1;
    void this.serve(begin, end);
  }

  private async serve(begin: number, end: number): Promise<void> {
    try {
      const chunk = await this.deps.readRange(begin, end);
      if (!this.aborted) {
        this.deps.deliver(begin, chunk);
      }
    } catch (err) {
      if (!this.aborted) {
        this.deps.onError?.(err);
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Stops delivering: in-flight reads still settle but their results are dropped. */
  abort(): void {
    this.aborted = true;
  }
}

/** The transport members this shim relies on (satisfied by pdf.js's PDFDataRangeTransport). */
export interface PdfDataRangeTransportLike {
  requestDataRange(begin: number, end: number): void;
  onDataRange(begin: number, chunk: Uint8Array | null): void;
  transportReady(): void;
  abort(): void;
}

/** Constructor shape of `PDFDataRangeTransport` (length + optional initial data). */
export type PdfDataRangeTransportCtor = new (
  length: number,
  initialData: Uint8Array | null
) => PdfDataRangeTransportLike;

export interface BuildPdfRangeTransportOptions {
  /** Bytes already in hand (e.g. a prefetched head). pdf.js won't re-request these. */
  initialData?: Uint8Array | null;
  /** Called when a range read fails, so the caller can surface/abort. */
  onError?(err: unknown): void;
}

/**
 * Wires a {@link PdfRangeController} onto an injected transport constructor and
 * returns a ready instance. Pure w.r.t. pdf.js — pass a fake `Ctor` in tests.
 */
export function buildPdfRangeTransport(
  Ctor: PdfDataRangeTransportCtor,
  size: number,
  source: RangeSource,
  options?: BuildPdfRangeTransportOptions
): PdfDataRangeTransportLike {
  let instance: PdfDataRangeTransportLike | null = null;

  const controller = new PdfRangeController({
    readRange: (begin, end) => source.readRange(begin, end),
    deliver: (begin, chunk) => {
      instance?.onDataRange(begin, chunk);
    },
    onError: (err) => options?.onError?.(err),
  });

  class StreamRangeTransport extends Ctor {
    requestDataRange(begin: number, end: number): void {
      controller.request(begin, end);
    }

    abort(): void {
      controller.abort();
      super.abort();
    }
  }

  instance = new StreamRangeTransport(size, options?.initialData ?? null);
  // Signal readiness so pdf.js starts issuing range requests against `size`.
  instance.transportReady();
  return instance;
}

/**
 * Production entry point: resolves the file size, lazily imports pdf.js, and
 * returns a real `PDFDataRangeTransport` wired to `source`. The dynamic import
 * keeps pdf.js out of any Node/test load path that doesn't call this.
 */
export async function createPdfDataRangeTransport(
  source: RangeSource,
  options?: BuildPdfRangeTransportOptions
): Promise<PDFDataRangeTransport> {
  const size = await source.getSize();
  const pdfjs = await import('pdfjs-dist');
  const Ctor = pdfjs.PDFDataRangeTransport as unknown as PdfDataRangeTransportCtor;
  return buildPdfRangeTransport(Ctor, size, source, options) as unknown as PDFDataRangeTransport;
}
