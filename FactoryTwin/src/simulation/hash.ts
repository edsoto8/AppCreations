/** Incremental 64-bit hash (two independent 32-bit FNV-1a lanes). */
export class RollingHash {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193 ^ 0x9e3779b9;
  count = 0;

  update(s: string): void {
    let h1 = this.h1;
    let h2 = this.h2;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x01000193) + 0x632be5ab;
    }
    // record separator
    h1 = Math.imul(h1 ^ 0x1e, 0x01000193);
    h2 = Math.imul(h2 ^ 0x1e, 0x01000193);
    this.h1 = h1 >>> 0;
    this.h2 = h2 >>> 0;
    this.count++;
  }

  digest(): string {
    return this.h1.toString(16).padStart(8, '0') + this.h2.toString(16).padStart(8, '0') + ':' + this.count;
  }
}
