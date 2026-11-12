# Publish comparison - dotnet11lab

- Generated: 2026-11-12T19:34:15Z · RID `linux-x64` · SDK 11.0.100 · 20 startup runs per mode
- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 logical cores, Ubuntu 24.04.5 LTS (kernel 6.18.44-fc-v378)
- Integrator final run on an otherwise idle 4-vCPU cloud VM. Timer: bash EPOCHREALTIME. Wall-clock includes process creation and teardown.

| Mode | Deployed size | Executable | Startup (median wall) | Peak working set | Max RSS | Dynamic code |
|---|---:|---:|---:|---:|---:|---|
| framework-dependent | 0.1 MB (4 files) | 0.0 MB | 68.728 ms | 27.3 MB |  | true |
| self-contained | 73.9 MB (1 files) | 73.9 MB | 65.371 ms | 26.1 MB |  | true |
| native-aot | 4.0 MB (1 files) | 4.0 MB | 4.447 ms | 5.8 MB |  | false |
