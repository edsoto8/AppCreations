# TaskFlow — Progress

| # | Milestone | Status |
|---|---|---|
| 1 | Environment and first application | Done |
| 2 | First user interface | Not started |
| 3 | MVVM and data binding | Not started |
| 4 | Task editing and navigation | Not started |
| 5 | Local data storage | Not started |
| 6 | UI improvements | Not started |
| 7 | Testing and code quality | Not started |
| 8 | Final review | Not started |

## Milestone 1 — Environment and first application

- .NET SDK 10.0.115 (Ubuntu package), `wasm-tools` workload, Uno.Templates 7.0.5.
- Created with `dotnet new unoapp -preset blank -presentation mvvm -markup xaml -theme fluent -nav blank -platforms desktop wasm`.
- Uno.Sdk 7.0.5 (pinned in `global.json`). `TreatWarningsAsErrors` added to `Directory.Build.props`.
- Verified: `net10.0-desktop` and `net10.0-browserwasm` build with 0 warnings; the desktop app launched under X11 (Xvfb) and rendered the starter page.
