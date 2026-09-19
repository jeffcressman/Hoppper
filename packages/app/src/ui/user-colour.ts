import { hash, SPECTRUM } from './hash';

/** The colour of a user's initial badge: a spectrum colour picked by name. */
export function userColour(userName: string): string {
  return `var(--spectrum-${SPECTRUM[hash(userName) % SPECTRUM.length]})`;
}
