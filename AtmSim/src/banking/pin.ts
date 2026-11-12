/**
 * SIMULATED PIN handling — NOT CRYPTOGRAPHY.
 *
 * Real ATMs encrypt the PIN inside a tamper-resistant Encrypting PIN Pad (EPP) into an ISO 9564 "PIN block"
 * using keys that never leave hardware security modules (HSMs). The bank host verifies the PIN inside its own
 * HSM; the clear PIN is never visible to software.
 *
 * This file imitates the *shape* of that flow with a toy 32-bit FNV-1a hash so learners can see that:
 *  - the ATM sends a PIN block, never the clear PIN;
 *  - the host verifies the block against a stored reference value;
 *  - the block changes with every transaction (it mixes in the STAN).
 * FNV-1a is trivially reversible for 4-digit PINs and must never be used for real security.
 */

/** 32-bit FNV-1a hash of a string, as 8 upper-case hex digits. Toy hash, not secure. */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, '0');
}

/** Tokenised card reference used in host messages instead of a card number (simulated tokenisation). */
export function cardTokenFor(cardId: string): string {
  return `TKN-${fnv1aHex(`card:${cardId}`)}`;
}

/** Reference value the (simulated) issuer stores for a card's PIN. */
export function hashPin(pin: string, cardToken: string): string {
  return fnv1aHex(`pin:${pin}:${cardToken}`);
}

/**
 * Simulated PIN block: "SIMPIN-" + 8 hex. Derived from the PIN reference value and the STAN so that every
 * transaction produces a different block (as real PIN blocks change with each encryption).
 */
export function makePinBlock(pin: string, cardToken: string, stan: string): string {
  return pinBlockFromHash(hashPin(pin, cardToken), stan);
}

/** Host side: the block it expects for a stored PIN reference value and the request's STAN. */
export function pinBlockFromHash(pinHash: string, stan: string): string {
  return `SIMPIN-${fnv1aHex(`blk:${pinHash}:${stan}`)}`;
}
