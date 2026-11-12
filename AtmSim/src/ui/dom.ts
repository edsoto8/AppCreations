type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** Tiny hyperscript helper: h('div', { class: 'x', onclick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement): HTMLElement {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el: HTMLElement, ...children: Child[]): HTMLElement {
  clear(el);
  append(el, children);
  return el;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Coalesce many update requests into one per animation frame. */
export function rafThrottle(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

export function fmtTime(simMs: number): string {
  const s = Math.floor(simMs / 1000);
  const base = 9 * 3600; // the training day starts at 09:00
  const t = base + s;
  const hh = Math.floor(t / 3600) % 24;
  const mm = Math.floor(t / 60) % 60;
  const ss = t % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Two-step confirmation inside the page (browser dialogs such as confirm() are not available in every
 * host): the first click arms the button and changes its label; a second click within 4 s runs the action.
 */
export function confirmClick(btn: HTMLElement, armedLabel: string, action: () => void): void {
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.textContent = btn.dataset.label ?? btn.textContent;
    action();
    return;
  }
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent ?? '';
  btn.textContent = armedLabel;
  setTimeout(() => {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.label ?? '';
    }
  }, 4000);
}
