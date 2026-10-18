/**
 * Content-Security-Policy for the production build (docs/architecture.md). The brief's four directives,
 * plus object-src/base-uri/form-action, which do not fall back to default-src and close
 * <base>-injection and form-exfiltration paths. 'unsafe-inline' styles: Recharts and Radix set inline
 * style attributes.
 */
export const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
