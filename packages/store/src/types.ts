/**
 * Shared contracts for the store. These types are the source of truth: a higher
 * layer may rename a screen, but not a field in here.
 */

export interface Facts {
  address: string;
  price?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  currency: 'AED' | 'GBP' | 'USD' | 'EUR';
  /** ISO timestamp. Unset means the user has not confirmed the facts yet. */
  confirmedAt?: string;
}

export type ListingStatus = 'draft' | 'analysing' | 'ready' | 'exported' | 'failed';

export interface ListingRecord {
  version: 1;
  /** `YYYY-MM-DD-<slug>` — see `isValidListingId`. */
  id: string;
  address: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  status: ListingStatus;
  facts: Facts;
  clipCount: number;
  notes?: string;
  lastError?: string;
}

export interface CreateListingInput {
  address: string;
  facts?: Partial<Facts>;
  /** ISO timestamp, injectable so tests never depend on the wall clock. */
  now?: string;
}

export interface Store {
  init(): Promise<void>;
  list(): Promise<ListingRecord[]>;
  get(id: string): Promise<ListingRecord | undefined>;
  create(input: CreateListingInput): Promise<ListingRecord>;
  update(
    id: string,
    patch: Partial<Omit<ListingRecord, 'id' | 'version' | 'createdAt'>>,
  ): Promise<ListingRecord>;
  remove(id: string): Promise<void>;
  /** Absolute path to a listing's workspace. */
  dirFor(id: string): string;
}

/** Absolute paths that make up one listing workspace. */
export interface ListingPaths {
  dir: string;
  record: string;
  media: string;
  cache: string;
}
