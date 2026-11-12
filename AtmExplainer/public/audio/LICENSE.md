# Audio License

All audio files in this folder (`*.wav`) are original works, procedurally synthesized for the
"How Cash Works Inside an ATM" explainer by `scripts/generate-audio.mjs` in this project.

- They are generated entirely from code (oscillators, filtered seeded noise, envelopes and simple
  effects). No third-party samples, recordings, loops, sound libraries or text-to-speech were used.
- The music bed (`music-bed.wav`) is an original composition written in that script.
- Generation is deterministic: running `npm run audio` recreates byte-identical files.

These files may be used, modified and redistributed freely with this project, without attribution
or royalty.
