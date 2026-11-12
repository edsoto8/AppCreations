# Publish comparison - dotnet11lab

> **PRELIMINARY** - validation run (e.g. on a busy machine). Do not quote these numbers.

- Generated: 2026-11-12T18:27:16Z · RID `linux-x64` · SDK 11.0.100 · 10 startup runs per mode
- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 logical cores, Ubuntu 24.04.5 LTS (kernel 6.18.44-fc-v378)
- Validation run on a contended shared 4-core container (other builds running). Timer: bash EPOCHREALTIME. Wall-clock includes process creation and teardown.

| Mode | Deployed size | Executable | Startup (median wall) | Peak working set | Max RSS | Dynamic code |
|---|---:|---:|---:|---:|---:|---|
| framework-dependent | 0.1 MB (4 files) | 0.0 MB | 78.771 ms | 27.3 MB |  | true |
| self-contained | 73.9 MB (1 files) | 73.9 MB | 76.683 ms | 26.1 MB |  | true |
| native-aot | 4.0 MB (1 files) | 4.0 MB | 5.230 ms | 5.7 MB |  | false |
