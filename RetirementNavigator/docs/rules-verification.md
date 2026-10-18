# Rules Verification (for owner spot-check before the M2 tag)

**Status (2026-10-18): NOT VERIFIED.** This environment's network policy blocks direct access to
irs.gov, ssa.gov and federalregister.gov, for both fetch and curl. The values below are **candidates**
taken from web-search excerpts of those official pages. **No document was read directly.** Until each
value is confirmed in its primary document, the rules files keep it as `status: 'unverified'`
(`value: null`, with the candidate stored for display only). The engine does not use candidates.

Retrieval method for every row: web-search excerpt, 2026-10-18.

## Top 15 high-impact values
| # | Rule | Year | Candidate | Primary document | Second source (excerpt) | Status |
|---|---|---|---|---|---|---|
| 1 | 401(k)/403(b)/457(b) elective deferral (402(g)) | 2026 | $24,500 | IRS Notice 2025-67 — https://www.irs.gov/pub/irs-drop/n-25-67.pdf | IR-2025-111; irs.gov 401(k) limits page | unverified |
| 2 | Catch-up 50+ / enhanced 60–63 | 2026 | $8,000 / $11,250 | Notice 2025-67 | IR-2025-111; irs.gov catch-up page | unverified |
| 3 | IRA limit / IRA catch-up | 2026 | $7,500 / $1,100 | Notice 2025-67 | IR-2025-111; Pub 590-A | unverified |
| 4 | Roth IRA phase-out single / MFJ | 2026 | $153k–$168k / $242k–$252k | Notice 2025-67 | Pub 590-A (2026) | unverified |
| 5 | Ordinary brackets single / MFJ | 2026 | 10/12/22/24/32/35/37% at 0 / 12,400 / 50,400 / 105,700 / 201,775 / 256,225 / 640,600 (single); 0 / 24,800 / 100,800 / 211,400 / 403,550 / 512,450 / 768,700 (MFJ) | IRS Rev. Proc. 2025-32 — https://www.irs.gov/pub/irs-drop/rp-25-32.pdf | IRS "Working Families Tax Cuts" page; Pub 505 | unverified |
| 6 | Standard deduction single / MFJ; additional 65+ unmarried / married | 2026 | $16,100 / $32,200; $2,050 / $1,650 | Rev. Proc. 2025-32 | IRB 2025-45; Form 1040-ES (2026) | unverified |
| 7 | Senior deduction (amount, phase-out start, rate, last year) | 2025–2028 | $6,000 per person; $75k / $150k; rate **not found**; last year 2028 | IRS newsroom (enhanced deduction for seniors) | Pub 554; Pub 4491-X | unverified (rate missing) |
| 8 | LTCG 0% / 15% tops, single / MFJ | 2026 | 49,450 / 545,500; 98,900 / 613,700 | Rev. Proc. 2025-32 | IRB 2025-45 | unverified |
| 9 | SS wage base | 2026 / 2027 | $184,500 / $192,300 | SSA COLA fact sheets 2026 / 2027 | IRS Pub 15 (2026) | unverified |
| 10 | 415(c) annual additions / 401(a)(17) compensation limit | 2026 | $72,000 / $360,000 | Notice 2025-67 | irs.gov 401(k) limits page | unverified |
| 11 | PIA bend points; factors 90/32/15 | 2026 / 2027 | 1,286 / 7,749; 1,340 / 8,077 | SSA OACT bendpoints.html | SSA piaformula.html | unverified |
| 12 | Full retirement age by birth year | standing | 66 (1943–54), +2 months per year 1955–59, 67 (1960+) | SSA OACT nra.html | SSA planner pages; 20 CFR 404.409 | unverified |
| 13 | Early reduction / DRC / spousal reduction | standing | 5/9% & 5/12% per month; 2/3% per month to 70; spousal 25/36% & 5/12% | 20 CFR 404.410; SSA delayret page | SSA Handbook §724 | unverified |
| 14 | RMD start age; Uniform Lifetime Table | standing | 73 (born 1951–58), 75 (1960+); **1959 ambiguous**; ages 72–75 = 27.4 / 26.5 / 25.5 / 24.6; **76+ not found** | Final RMD regs (T.D. 10001) / Pub 590-B App. B | Federal Register 2024-14542 | unverified |
| 15 | SS benefit-taxation thresholds | standing (statutory-fixed) | $25k / $34k single; $32k / $44k MFJ | IRS Pub 915 | SSA benefits planner (taxes) | unverified |

## Other candidates found (not in the top 15)
- HSA 2026: $4,400 / $8,750 (Rev. Proc. 2025-19). HSA 2027: $4,500 / $9,000 (Rev. Proc. 2026-24).
  HSA catch-up: $1,000 (Pub 969); indexation status not stated.
- Roth catch-up wage threshold: $150,000 (2026, applied to 2025 FICA wages). Final regs apply to
  taxable years beginning after 2026-12-31, with good-faith compliance before then.
- SS COLA: 2.8% (Jan 2026), 3.6% (Jan 2027). Earnings test 2026: $24,480 / $65,160; 2027: $25,560 / $67,920.
- AWI: 2023 66,621.80; 2024 69,846.57; 2025 72,800.33.
- WEP/GPO: repealed by the Social Security Fairness Act (signed 2025-01-05), for benefits payable
  after December 2023.
- Roth 401(k): no lifetime RMDs for the owner from 2024 (SECURE 2.0 §325).
- FICA rates: OASDI 6.2%, Medicare 1.45% (Pub 15, 2026).
- 2027 IRS items other than HSA (deferral limits, IRA, phase-outs, brackets, standard deduction,
  LTCG) have **not been published** as of 2026-10-18.

## Open items that block verification
1. Direct access to irs.gov, ssa.gov and federalregister.gov (an environment network-policy change).
2. Senior deduction phase-out rate: not found.
3. RMD start age for people born in 1959: the final regulations reserve this paragraph.
4. Uniform Lifetime Table ages 76 and above: not seen.
5. Roth IRA reduced-contribution rounding rules (Pub 590-A worksheet): not yet checked.
6. Rounding metadata for indexed limits (for example "multiples of $500"): not yet checked at source.
