/**
 * Imported first by main.tsx (ES modules evaluate in import order). The CSP forbids eval, and
 * Zod 4's JIT probes `new Function`, which logs a CSP violation; run Zod jitless instead.
 */
import { z } from 'zod';

z.config({ jitless: true });
