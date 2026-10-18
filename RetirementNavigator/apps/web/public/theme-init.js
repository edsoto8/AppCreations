// Applies the saved theme before first paint (external file so the CSP needs no inline script).
(function () {
  var theme = 'system';
  try {
    theme = window.localStorage.getItem('rn-theme') || 'system';
  } catch {
    // Storage can be unavailable (private mode); fall back to the system preference.
  }
  var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
