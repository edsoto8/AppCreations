namespace StepRecorder.Core.Reporting;

/// <summary>Static files that sit next to <c>report.html</c>. Kept in code so there is no resource plumbing.</summary>
internal static class ReportAssets
{
    public const string Css = """
        :root {
          color-scheme: light dark;
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #1b1f24;
          --muted: #5c6670;
          --border: #dde1e6;
          --accent: #c4262e;
          --note-bg: #fff6e0;
          --note-text: #6b4a00;
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #15181c;
            --card: #1e2227;
            --text: #e6e9ec;
            --muted: #9aa4ae;
            --border: #333a42;
            --accent: #ff5a5f;
            --note-bg: #3a2f12;
            --note-text: #f3d48a;
          }
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 24px 16px 48px;
          background: var(--bg);
          color: var(--text);
          font: 15px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
        }

        .report-header, main, footer { max-width: 1100px; margin: 0 auto; }

        h1 { font-size: 1.75rem; margin: 0 0 12px; overflow-wrap: anywhere; }

        .meta { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0 0 24px; color: var(--muted); }
        .meta div { display: flex; gap: 6px; }
        .meta dt { font-weight: 600; }
        .meta dt::after { content: ":"; }
        .meta dd { margin: 0; color: var(--text); }

        .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 20px; }

        .step article {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px 18px;
        }

        .step header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .step h2 { font-size: 1.1rem; margin: 0; overflow-wrap: anywhere; }
        .step h2 a { color: inherit; text-decoration: none; }
        .step h2 a:hover, .step h2 a:focus-visible { text-decoration: underline; }
        .step time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }

        .description { margin: 6px 0 12px; overflow-wrap: anywhere; }

        .badge {
          display: inline-block;
          margin-left: 6px;
          padding: 0 8px;
          border-radius: 10px;
          background: var(--note-bg);
          color: var(--note-text);
          font-size: 0.8rem;
          font-weight: 600;
          vertical-align: 1px;
        }

        .shot { margin: 0; }
        .shot-link {
          position: relative;
          display: inline-block;
          max-width: 100%;
          line-height: 0;
          border: 1px solid var(--border);
          border-radius: 4px;
          overflow: hidden;
        }
        .shot img { display: block; max-width: 100%; height: auto; cursor: zoom-in; }
        .shot.zoomed .shot-link { overflow-x: auto; }
        .shot.zoomed img { max-width: none; cursor: zoom-out; }

        /* Same colors as the burned-in marker (ScreenshotAnnotator). */
        .click-marker { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .click-marker circle { fill: none; }
        .click-marker .halo { stroke: rgba(255, 255, 255, 0.85); }
        .click-marker .ring { stroke: #e3262f; }

        .shot-note {
          margin: 10px 0 0;
          padding: 8px 12px;
          border-radius: 6px;
          background: var(--note-bg);
          color: var(--note-text);
        }

        .empty { color: var(--muted); }

        footer { margin-top: 32px; color: var(--muted); font-size: 0.85rem; }

        @media print {
          body { background: #fff; color: #000; padding: 0; }
          .step article { break-inside: avoid; border-color: #ccc; }
          .shot img { cursor: default; }
          footer { display: none; }
        }
        """;

    // Without JavaScript, clicking a screenshot opens the full-size PNG instead.
    public const string Script = """
        "use strict";
        document.addEventListener("click", function (event) {
          var link = event.target.closest && event.target.closest(".shot-link");
          if (!link || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
          }
          event.preventDefault();
          link.parentElement.classList.toggle("zoomed");
        });
        """;
}
