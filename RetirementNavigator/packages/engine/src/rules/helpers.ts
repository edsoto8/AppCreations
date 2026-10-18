/**
 * Constructors for Verified<T> rule entries. Data files use these so every entry has the full shape.
 * Never type a regulatory number without a source (docs/rules-verification.md).
 */
import type { Indexation, Rounding, RuleSource, Verified } from '../domain/rules';

export const BLOCKED_REASON =
  'Primary document not readable from this environment (network policy blocks irs.gov, ssa.gov and federalregister.gov); only a web-search excerpt of the official page was seen. Pending primary-document verification.';

export interface SourceRef {
  publication: string;
  url: string;
  locator?: string;
}

function source(ref: SourceRef, retrievedOn: string, method: RuleSource['method']): RuleSource {
  return { publication: ref.publication, url: ref.url, locator: ref.locator ?? null, retrievedOn, method };
}

/** A value read in the primary document (status 'verified'). */
export function verifiedRule<T>(
  value: T,
  ref: SourceRef,
  opts: {
    retrievedOn: string;
    indexation: Indexation;
    secondSource?: SourceRef;
    rounding?: Rounding;
    sunsetYear?: number;
    notes?: string;
  },
): Verified<T> {
  return {
    status: 'verified',
    value,
    source: source(ref, opts.retrievedOn, 'primary-document'),
    secondSource: opts.secondSource ? source(opts.secondSource, opts.retrievedOn, 'primary-document') : null,
    indexation: opts.indexation,
    rounding: opts.rounding ?? null,
    sunsetYear: opts.sunsetYear ?? null,
    notes: opts.notes ?? null,
  };
}

/** Unverified: a candidate was seen only in a search excerpt. The engine never reads the candidate. */
export function candidateRule<T>(
  value: T,
  ref: SourceRef,
  opts: { retrievedOn: string; indexation?: Indexation; reason?: string },
): Verified<T> {
  return {
    status: 'unverified',
    value: null,
    source: null,
    unverifiedReason: opts.reason ?? BLOCKED_REASON,
    indexation: opts.indexation ?? null,
    candidate: { value, source: source(ref, opts.retrievedOn, 'search-excerpt') },
  };
}

/** Unverified with no candidate (not found or ambiguous). */
export function unverifiedRule<T>(reason: string, indexation?: Indexation): Verified<T> {
  return {
    status: 'unverified',
    value: null,
    source: null,
    unverifiedReason: reason,
    indexation: indexation ?? null,
    candidate: null,
  };
}

/** Not yet published by the agency for this year. */
export function notPublishedRule<T>(reason: string, indexation?: Indexation): Verified<T> {
  return {
    status: 'notPublished',
    value: null,
    source: null,
    unverifiedReason: reason,
    indexation: indexation ?? null,
  };
}
