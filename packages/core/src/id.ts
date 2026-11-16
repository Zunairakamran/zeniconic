import { slugify } from './format';

export function listingId(address: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  const slug = slugify(address);

  if (slug.length === 0) {
    throw new RangeError(`Address "${address}" has no alphanumeric characters to build an id from`);
  }

  return `${day}-${slug}`;
}
