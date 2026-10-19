#!/usr/bin/env python3
"""Independent Python reference for the Retirement Navigator deterministic projection (M3 + M4).

Written from docs/financial-model.md only (never from the engine source). Python 3.13, stdlib only.

Two rule sets, chosen per fixture (`rules` in the fixture JSON):
  - "bundled": the app's bundled rules, where every regulatory value is unverified (docs §1.7).
    Workplace limits, IRA/HSA limits, taxes, RMDs, PIA-based Social Security, spousal/survivor
    benefits and Roth qualification are left out; everything rule-free is modeled.
  - "fixture": the PINNED SYNTHETIC rule values of src/testing/fixtureRules.ts (round numbers, NOT
    real IRS/SSA values), translated by hand below. Every value is verified, so the full M4 path runs.
    The fixture has one tax year (2026); later years are resolved with docs §2 (indexed values
    grow with the inflation assumption and use the published rounding metadata; statutory-fixed
    values are carried; the senior deduction is absent after its 2028 sunset).

Scope:
  - M3 (§1, §3, §4): ages, phases, longevity; salary, raises, bonus, part-time; workplace plans
    (before limits, or after the §3.4 limits with fixture rules); vesting and forfeiture;
    scheduled contributions (before limits, or after the §3.6/§3.7 IRA, Roth IRA and HSA limits);
    growth, fees, drag, shocks, annual and monthly timing; withdrawal strategies.
  - M4 (§5-§7): spending steps, real glide, pre-Medicare healthcare, survivor reduction; pensions
    (annuity, COLA modes, survivor fraction, lump sums); one-time inflows and outflows; Social
    Security (atClaimAge; statement PIA with claim factors, spousal excess and survivor with
    fixture rules); RMDs; HSA qualified medical withdrawals; reinvestment of excess income; the §6
    tax model; the §7.2 gross-up solver; bracket fill; Roth/HSA flags; filing status after death;
    the verified accumulation path (net pay, surplus, routing, infeasible years).

Paths the docs leave ambiguous raise `Unsupported`, so no fixture can silently depend on a guess
(for example: two deferral buckets scaled pro rata, the Roth catch-up rule binding, a death during
the accumulation phase, RMDs while someone works, a spousal excess in a partial claim year, a
survivor who has not claimed, a pension whose owner dies before its start age, retirement-phase
scheduled contributions or HSA medical limited by the remaining need under verified taxes,
taxation of an accumulation-phase outflow withdrawal, bracket fill once every other account is
empty). Assumptions where the docs are silent but a choice is needed are marked "ASSUMPTION":
  - the survivor spending reduction (§5) multiplies the whole retirement need, healthcare included;
  - Pub 915 "other income" (§6) is AGI before Social Security, including long-term gains;
  - the tax step works in cents (TaxInput/TaxBreakdown in src/api.ts): inputs and each reported
    component are rounded to cents, totalTax is their sum, netIncome = grossIncome − totalTax;
  - the gross-up (§7.2) returns W_{k+1} of the last pass; the unfunded need (shortfall) exists only
    when W exceeds the total cap; excess income is reinvested only when no withdrawal is needed;
  - grossIncome counts every gross inflow of the year (fixed income, RMDs, HSA medical and strategy
    withdrawals) before any reinvestment; in accumulation years it includes SS and pensions;
  - a one-time inflow into a taxable account adds its whole amount to basis (the gain is taxed in
    the event); an inflow with nowhere to go is still counted in flows.oneTimeInflows, is not
    spending income, and raises oneTimeInflowSpent;
  - a reinvested amount is rounded to whole cents (§1.3, like a routed surplus);
  - HSA non-medical withdrawals are ordinary income at any age (§6 and §7.4; §7.1 step 7 says 65+);
  - with the bundled rules, `excludedFeatures` lists only the features the docs make certain are
    needed (the golden test checks it as a subset); with fixture rules it is exact (empty);
  - the per-person `pension` figure is not compared in a year a survivor continuation is paid
    (which row carries it is not documented).

Rounding (§1.3): all math in float64 dollars; each output is converted to cents once, rounding half
to even (a float that is within a few ulps of an exact half is treated as the tie, mirroring
src/money.test.ts); growthNet is the reconciling item. Contribution amounts are whole cents.

CLI (run from RetirementNavigator/):
  python3 packages/engine/reference/ref.py --write   # regenerate reference/fixtures/*.json
  python3 packages/engine/reference/ref.py --check   # recompute; exit 1 on any difference
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import pathlib
import subprocess
import sys
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
CURRENT_YEAR = 2026


class Unsupported(Exception):
    """A path the docs leave ambiguous; fixtures must not use it."""


# --------------------------------------------------------------------------------------------
# Rounding (§1.3)
# --------------------------------------------------------------------------------------------


def cents(dollars: float) -> int:
    """Float dollars -> integer cents, round half to even, once."""
    v = dollars * 100.0
    if not math.isfinite(v):
        raise ValueError(f"non-finite amount {dollars!r}")
    n = math.floor(v)
    f = v - n
    tol = 1e-9 + abs(v) * 1e-15  # a float within a few ulps of .5 is the tie (money.test.ts)
    if abs(f - 0.5) <= tol:
        c = n if n % 2 == 0 else n + 1
    elif f < 0.5:
        c = n
    else:
        c = n + 1
    return int(c) + 0


def whole_cents(dollars: float) -> float:
    """A contribution amount in whole cents (§1.3), returned as float dollars for the account math."""
    return cents(dollars) / 100


def d(c: int) -> float:
    """Input cents -> float dollars."""
    return c / 100.0


# --------------------------------------------------------------------------------------------
# Synthetic fixture rules (src/testing/fixtureRules.ts), translated by hand. Dollars.
# --------------------------------------------------------------------------------------------

FIXTURE_TAX_YEAR = 2026
# key -> (value, indexation, rounding (mode, increment dollars) or None, sunsetYear or None)
FIXTURE_YEAR_VALUES: dict[str, tuple[Any, str, Any, Any]] = {
    "electiveDeferral": (20_000, "indexed", ("down", 500), None),
    "catchUp50": (7_000, "indexed", ("down", 500), None),
    "catchUp60to63": (9_000, "indexed", None, None),
    "annualAdditions": (60_000, "indexed", ("down", 1_000), None),
    "compensationLimit": (300_000, "indexed", ("down", 5_000), None),
    "rothCatchUpWageThreshold": (140_000, "indexed", None, None),
    "rothCatchUpInForce": (True, "statutory-fixed", None, None),
    "iraLimit": (8_500, "indexed", ("down", 500), None),
    "iraCatchUp50": (1_200, "indexed", None, None),
    "rothPhaseOut.single": ((100_000, 112_000), "indexed", None, None),
    "rothPhaseOut.marriedFilingJointly": ((200_000, 216_000), "indexed", None, None),
    "hsa.selfOnly": (4_000, "indexed", None, None),
    "hsa.family": (8_000, "indexed", None, None),
    "hsa.catchUp55": (1_200, "statutory-fixed", None, None),
    "brackets.single": ([(0.1, 0), (0.2, 10_000), (0.3, 50_000)], "indexed", None, None),
    "brackets.marriedFilingJointly": ([(0.1, 0), (0.2, 20_000), (0.3, 100_000)], "indexed", None, None),
    "standardDeduction.single": (15_000, "indexed", None, None),
    "standardDeduction.marriedFilingJointly": (30_000, "indexed", None, None),
    "additional65.unmarried": (2_000, "indexed", None, None),
    "additional65.married": (1_500, "indexed", None, None),
    "senior.amountPerPerson": (5_000, "statutory-fixed", None, 2029),
    "senior.phaseOutStart.single": (70_000, "statutory-fixed", None, None),
    "senior.phaseOutStart.marriedFilingJointly": (140_000, "statutory-fixed", None, None),
    "senior.phaseOutRate": (0.05, "statutory-fixed", None, None),
    "ltcg.single": ((40_000, 500_000), "indexed", None, None),
    "ltcg.marriedFilingJointly": ((80_000, 600_000), "indexed", None, None),
    "ssWageBase": (150_000, "indexed", None, None),
}

# Standing rules of the fixture (not tied to a tax year; never indexed).
ST_OASDI = 0.06
ST_MEDICARE = 0.015
ST_CG_RATES = (0.0, 0.1, 0.25)
ST_SS_THRESHOLDS = {"single": (20_000, 30_000), "marriedFilingJointly": (30_000, 40_000)}
ST_SS_INCLUSION = (0.4, 0.8)
ST_ROTH_ROUNDING = (10, 200)  # round up to $10, minimum $200
ST_ROTH_QUALIFIED_AGE_MONTHS = 59 * 12 + 4
ST_ROTH_FIVE_YEARS = 4
ST_ROTH401K_RMD = False
ST_EARLY = (0.005, 0.004)  # per month, first 36 / beyond
ST_DELAYED = 0.006  # per month
ST_DELAYED_MAX_AGE = 70
ST_SPOUSAL = (0.45, 0.006, 0.004)  # max share of the other PIA, reduction per month first 36 / beyond
ST_SURVIVOR_FLOOR = 0.8  # RIB-LIM floor share of the deceased PIA
ST_SURVIVOR_SHARE = 0.95  # maxShareOfDeceased


def st_rmd_start_age(birth_year: int) -> int:
    if 1900 <= birth_year <= 1959:
        return 71
    if birth_year >= 1960:
        return 74
    raise Unsupported(f"no RMD start age for birth year {birth_year}")


def st_ult_period(age: int) -> float:
    if not 70 <= age <= 120:
        raise Unsupported(f"no Uniform Lifetime Table period for age {age}")
    return (60 - (age - 70)) / 2  # 30 at 70, 25 at 80, 5 at 120


def st_fra_months(birth_year: int) -> int:
    return 66 * 12 if birth_year <= 1949 else 67 * 12


def resolve_year(year: int, index_rate: float) -> dict[str, Any]:
    """§2: the fixture's tax-year values in force for `year` (anchor = the 2026 fixture year)."""
    n = year - FIXTURE_TAX_YEAR
    if n < 0:
        raise Unsupported("tax year before the fixture year")
    out: dict[str, Any] = {}
    growth = (1.0 + index_rate) ** n

    def money(v: float, rounding: Any) -> float:
        x = v * growth
        if n == 0:
            return float(v)
        if rounding is None:
            return cents(x) / 100  # no rounding metadata: rounded to the cent
        mode, inc = rounding
        if mode == "down":
            return math.floor(x / inc + 1e-9) * inc
        if mode == "up":
            return math.ceil(x / inc - 1e-9) * inc
        return round(x / inc) * inc

    for key, (value, indexation, rounding, sunset) in FIXTURE_YEAR_VALUES.items():
        if sunset is not None and year > sunset:
            out[key] = None  # law as written: the provision is absent after its sunset year
            continue
        if indexation == "statutory-fixed" or isinstance(value, bool):
            out[key] = value
        elif key.startswith("brackets."):
            out[key] = [(rate, money(lb, rounding)) for rate, lb in value]  # rates are never indexed
        elif isinstance(value, tuple):
            out[key] = tuple(money(v, rounding) for v in value)
        else:
            out[key] = money(value, rounding)
    return out


# --------------------------------------------------------------------------------------------
# Tax model (§6)
# --------------------------------------------------------------------------------------------


def bracket_tax(brackets: list[tuple[float, float]], taxable: float) -> float:
    tax = 0.0
    for i, (rate, lb) in enumerate(brackets):
        ub = brackets[i + 1][1] if i + 1 < len(brackets) else math.inf
        if taxable > lb:
            tax += rate * (min(taxable, ub) - lb)
    return tax


def taxable_ss(benefits: float, other_income: float, status: str) -> float:
    """Pub 915 provisional-income method (§6)."""
    if benefits <= 0:
        return 0.0
    base, adjusted = ST_SS_THRESHOLDS[status]
    t1, t2 = ST_SS_INCLUSION
    pi = other_income + 0.0 + t1 * benefits  # no tax-exempt interest in the model
    if pi <= base:
        return 0.0
    if pi <= adjusted:
        return min(t1 * (pi - base), t1 * benefits)
    return min(t2 * benefits, t2 * (pi - adjusted) + min(t1 * (adjusted - base), t1 * benefits))


def deduction(R: dict, status: str, ages: list[int], magi: float) -> float:
    n65 = sum(1 for age in ages if age >= 65)
    ded = R[f"standardDeduction.{status}"]
    ded += n65 * R["additional65.married" if status == "marriedFilingJointly" else "additional65.unmarried"]
    amount = R["senior.amountPerPerson"]
    if amount is not None:  # absent after its sunset (law as written)
        start = R[f"senior.phaseOutStart.{status}"]
        ded += n65 * max(0.0, amount - R["senior.phaseOutRate"] * max(0.0, magi - start))
    return ded


def compute_tax(
    R: dict,
    status: str,
    ages: list[int],
    wages_by_person: list[float],
    pre_tax: float,
    other_ordinary: float,
    ss: float,
    ltcg: float,
    state_rate: float,
) -> dict[str, float]:
    """§6 simplified federal + flat state + FICA.

    ASSUMPTION (granularity): the frozen API passes the tax step's inputs and outputs in cents
    (`TaxInput`, `TaxBreakdown` in src/api.ts), so the inputs are rounded to cents, each reported
    component is rounded to cents once, and the total is the sum of the components. Net income is
    grossIncome − totalTax in cents (§7.2 output).
    """
    c = lambda x: cents(x) / 100  # noqa: E731
    wages_by_person = [c(w) for w in wages_by_person]
    pre_tax, other_ordinary, ss, ltcg = c(pre_tax), c(other_ordinary), c(ss), c(ltcg)
    wages = sum(wages_by_person)
    base_ord = wages - pre_tax + other_ordinary
    # ASSUMPTION: Pub 915 "other income" is AGI before Social Security, so it includes long-term gains.
    tss = c(taxable_ss(ss, base_ord + ltcg, status))
    ordinary = base_ord + tss
    agi = ordinary + ltcg
    ded = c(deduction(R, status, ages, agi))  # MAGI = AGI (simplification)
    taxable_ord = max(0.0, ordinary - ded)
    unused = max(0.0, ded - ordinary)
    gains = max(0.0, ltcg - unused)  # any unused deduction offsets gains first
    ord_tax = c(bracket_tax(R[f"brackets.{status}"], taxable_ord))
    zero_max, fifteen_max = R[f"ltcg.{status}"]
    low, mid, high = ST_CG_RATES
    lo, hi = taxable_ord, taxable_ord + gains
    seg = lambda a, b: max(0.0, min(hi, b) - max(lo, a))  # noqa: E731
    cg_tax = c(low * seg(0, zero_max) + mid * seg(zero_max, fifteen_max) + high * seg(fifteen_max, math.inf))
    fica_ss = c(sum(ST_OASDI * min(w, R["ssWageBase"]) for w in wages_by_person))
    fica_med = c(sum(ST_MEDICARE * w for w in wages_by_person))
    state = c(state_rate * agi)
    total = ord_tax + cg_tax + fica_ss + fica_med + state
    return {
        "wages": wages,
        "taxableSocialSecurity": tss,
        "agi": agi,
        "deductions": ded,
        "taxableOrdinary": taxable_ord,
        "federalOrdinaryTax": ord_tax,
        "capitalGainsTax": cg_tax,
        "ficaSocialSecurity": fica_ss,
        "ficaMedicare": fica_med,
        "stateTax": state,
        "totalTax": total,
        "ordinaryBeforeDeduction": ordinary,
    }


# --------------------------------------------------------------------------------------------
# Input defaults (mirrors the HouseholdSchema defaults used by this reference's scope)
# --------------------------------------------------------------------------------------------


def employment_of(person: dict) -> dict | None:
    e = person.get("employment")
    if e is None:
        return None
    return {
        "baseSalary": e["baseSalary"],
        "bonus": e.get("bonus", {"kind": "none"}),
        "bonusGrowth": e.get("bonusGrowth", {"mode": "withSalary"}),
        "bonusCountsForDeferrals": e.get("bonusCountsForDeferrals", True),
        "bonusCountsForMatch": e.get("bonusCountsForMatch", True),
        "raise": e["raise"],
        "raiseOverrides": {o["year"]: o["rate"] for o in e.get("raiseOverrides", [])},
        "stopAge": e.get("stopAge"),
        "partTime": e.get("partTime"),
        "priorYearFicaWages": e.get("priorYearFicaWages"),
    }


def plan_of(plan: dict) -> dict:
    m = plan["match"]
    return {
        "id": plan["id"],
        "planType": plan["planType"],
        "traditionalAccountId": plan["traditionalAccountId"],
        "rothAccountId": plan.get("rothAccountId"),
        "offersRoth": plan.get("planOffersRoth", False),
        "pTsal": plan.get("traditionalPctOfSalary", 0.0),
        "pRsal": plan.get("rothPctOfSalary", 0.0),
        "pTbon": plan.get("traditionalPctOfBonus", 0.0),
        "pRbon": plan.get("rothPctOfBonus", 0.0),
        "auto": plan.get("autoEscalation"),
        "tiers": m.get("tiers", []),
        "flat": m.get("flatPctOfPay", 0.0),
        "cap": m.get("annualMatchCap"),
        "vesting": m.get("vesting", {"kind": "immediate"}),
        "yos0": m.get("yearsOfServiceAtStart", 0),
        "dest": plan.get("matchDestination", "traditional"),
    }


def vested_fraction(vesting: dict, years: int) -> float:
    kind = vesting["kind"]
    if kind == "immediate":
        return 1.0
    if kind == "cliff":
        return 1.0 if years >= vesting["years"] else 0.0
    v = vesting["vestedByYear"]  # v[k] = vested after k+1 completed years
    if years <= 0:
        return 0.0
    return v[min(years, len(v)) - 1]


def match_amount(tiers: list, cap: Any, deferral: float, e_match: float) -> float:
    """§3.5 tiered match on the deferral rate δ = deferral / E^match, then the annual cap."""
    delta = deferral / e_match if e_match > 0 else 0.0
    m = 0.0
    lo = 0.0
    for tier in tiers:
        hi = lo + tier["bandPctOfPay"]
        m += tier["matchRate"] * max(0.0, min(delta, hi) - lo) * e_match
        lo = hi
    if cap is not None:
        m = min(m, d(cap))
    return m


WITHDRAWAL_GROUP = {
    "cash": "cash",
    "taxableBrokerage": "taxable",
    "workplaceTraditional": "traditional",
    "traditionalIra": "traditional",
    "workplaceRoth": "roth",
    "rothIra": "roth",
    "hsa": "hsa",
}
TAX_TREATMENT = {
    "workplaceTraditional": "taxDeferred",
    "traditionalIra": "taxDeferred",
    "workplaceRoth": "taxFree",
    "rothIra": "taxFree",
    "hsa": "taxFree",
    "taxableBrokerage": "taxable",
    "cash": "taxable",
}
STRATEGY_ORDER = {
    "taxableFirst": [["cash"], ["taxable"], ["traditional"], ["roth"], ["hsa"]],
    "traditionalFirst": [["traditional"], ["cash"], ["taxable"], ["roth"], ["hsa"]],
    "rothLast": [["cash", "taxable", "traditional"], ["hsa"], ["roth"]],
    "proportional": [["cash", "taxable", "traditional", "roth", "hsa"]],
}
# §7.3: bracketFill needs verified brackets; otherwise it falls back to taxableFirst with a warning.
STRATEGY_ORDER["bracketFill"] = STRATEGY_ORDER["taxableFirst"]
BRACKET_FILL_REST = [["cash"], ["taxable"], ["roth"], ["hsa"]]


def factors(rho: float, timing: str, granularity: str) -> tuple[float, float, float]:
    """(g_S, g_C, g_W) per the §1.5 timing table."""
    g_s = 1.0 + rho
    if granularity == "annual":
        half = math.sqrt(1.0 + rho)
        return g_s, half, (half if timing == "midYear" else g_s)
    rho_m = (1.0 + rho) ** (1.0 / 12.0) - 1.0
    a = 1.0 if rho == 0 else rho / (12.0 * rho_m)
    return g_s, a, (a if timing == "midYear" else a * (1.0 + rho_m))


def withdrawal_cap(s: float, c: float, g: tuple[float, float, float], timing: str, granularity: str) -> float:
    g_s, g_c, g_w = g
    if granularity == "annual" and timing == "startOfYear":
        return max(0.0, s)
    return max(0.0, (g_s * s + g_c * c) / g_w)


def draw(amount: float, caps: dict, accounts: list, groups: list) -> tuple[dict, float]:
    """Draw `amount` by groups in order; within a group pro rata by cap (§4.1 step 4, §7.3)."""
    wd = {x["id"]: 0.0 for x in accounts}
    remaining = amount
    for group in groups:
        if remaining <= 0:
            break
        ids = [x["id"] for x in accounts if WITHDRAWAL_GROUP.get(x["type"]) in group]
        cap_sum = sum(caps[i] for i in ids)
        if cap_sum <= 0:
            continue
        take = min(remaining, cap_sum)
        for i in ids:
            wd[i] = take * caps[i] / cap_sum
        remaining -= take
    return wd, max(0.0, remaining)


# --------------------------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------------------------


def project(h: dict, current_year: int, rules: str = "bundled", return_offset: float = 0.0) -> dict:
    V = rules == "fixture"  # every rule verified (synthetic fixture) vs every rule unverified (bundled)
    a = h["assumptions"]
    sp = h["spending"]
    inflation = a["inflation"]
    timing = a.get("withdrawalTiming", "midYear")
    granularity = a.get("granularity", "annual")
    drag = a.get("taxableAccountTaxDrag", 0.0)
    strategy = a.get("withdrawalStrategy", "taxableFirst")
    shock = a.get("marketShock")
    cma = a["capitalMarket"]
    min_end = d(a.get("minimumEndingBalance", 0))
    state_rate = a.get("stateTaxRate", 0.0)
    gross_up = a.get("grossUp", {})
    max_iter = gross_up.get("maxIterations", 50)
    tol = gross_up.get("toleranceCents", 100) / 100
    fill_rate = a.get("bracketFillTopRate")
    surplus_cfg = a.get("surplus", {"mode": "spent"})
    ss_cfg = a.get("socialSecurity", {})
    ss_cola = ss_cfg.get("cola", {"mode": "inflation"})
    ss_red = ss_cfg.get("benefitReduction")
    if a.get("rules", {}).get("indexing", {"mode": "inflation"})["mode"] != "inflation":
        raise Unsupported("index rate other than inflation")
    if a["rules"]["anchorYear"] != FIXTURE_TAX_YEAR and V:
        raise Unsupported("fixture rules need anchorYear 2026")

    steps = sorted(sp.get("steps", []), key=lambda s: s["fromAge"])
    glide = sp.get("retirementRealGlide", 0.0)
    healthcare = d(sp.get("healthcareBeforeMedicare", 0))
    survivor_reduction = sp.get("survivorSpendingReduction", 0.2)
    medical = d(sp.get("hsaQualifiedMedicalExpenses", 0))

    people = h["people"]
    for p in people:
        p.setdefault("planningAge", 100)
        p.setdefault("birthMonth", 1)
    couple = len(people) == 2
    mfj = h["filingStatus"] == "marriedFilingJointly"
    y1 = current_year
    last = max(p["birthYear"] + p["planningAge"] for p in people)
    n_years = last - y1 + 1

    emps = [employment_of(p) for p in people]
    plans = [[plan_of(w) for w in p.get("workplacePlans", [])] for p in people]
    accounts = h.get("accounts", [])
    if any(x["type"] == "other" for x in accounts):
        raise Unsupported("'other' accounts are not modeled by this reference")
    acct_by_id = {x["id"]: x for x in accounts}
    person_idx = {p["id"]: k for k, p in enumerate(people)}
    pensions = h.get("pensions", [])
    events = h.get("oneTimeEvents", [])
    first_taxable = next((x["id"] for x in accounts if x["type"] == "taxableBrokerage"), None)
    first_cash = next((x["id"] for x in accounts if x["type"] == "cash"), None)
    reinvest_dest = first_taxable or first_cash  # §7.1 step 6

    excluded: set[str] = set()
    warnings: set[str] = set()

    bal = {x["id"]: d(x["balance"]) for x in accounts}
    basis = {}
    for x in accounts:
        if x["type"] == "taxableBrokerage":
            basis[x["id"]] = d(x["costBasis"])
        elif x["type"] == "rothIra":
            basis[x["id"]] = d(x["contributionBasis"])
    # §4: the sub-ledger holds employer money subject to vesting; the entered unvested balance is the
    # part not vested today, U0 = E0·(1 − v0), so E0 = U0 / (1 − v0). With no linked plan (or v0 = 1)
    # the entered amount is never forfeited.
    unvested = {x["id"]: 0.0 for x in accounts}
    for k, p in enumerate(people):
        for w in p.get("workplacePlans", []):
            pl0 = plan_of(w)
            dest0 = pl0["rothAccountId"] if pl0["dest"] == "roth" else pl0["traditionalAccountId"]
            x0 = acct_by_id.get(dest0)
            if x0 is None:
                continue
            u0 = min(d(x0.get("unvestedEmployerBalance", 0)), d(x0["balance"]))
            v0 = vested_fraction(pl0["vesting"], pl0["yos0"])
            if u0 > 0 and v0 < 1:
                unvested[dest0] = u0 / (1.0 - v0)

    plan_state = [[{"separated": False, "worked": 0} for _ in pl] for pl in plans]
    base_prev = [None] * len(people)
    bonus_prev = [None] * len(people)
    prior_fica_wages: list[float | None] = [
        (d(e["priorYearFicaWages"]) if e is not None and e["priorYearFicaWages"] is not None else None) for e in emps
    ]

    def last_working_year(k: int) -> int:
        p = people[k]
        e = emps[k]
        stop = e["stopAge"] if e is not None and e["stopAge"] is not None else p["retirementAge"]
        return p["birthYear"] + stop - 1

    def account_return(x: dict, phase: str, year: int) -> float:
        if shock is not None and 0 <= year - shock["startYear"] < len(shock["returns"]):
            r = shock["returns"][year - shock["startYear"]]
        elif x.get("expectedReturn") is not None:
            r = x["expectedReturn"]
        elif x.get("allocation") is not None:
            al = x["allocation"]
            r = (
                al["stocks"] * cma["stocks"]["geometricReturn"]
                + al["bonds"] * cma["bonds"]["geometricReturn"]
                + al["cash"] * cma["cash"]["geometricReturn"]
            )
        else:
            r = a["returnPreRetirement"] if phase == "accumulation" else a["returnPostRetirement"]
        return max(-0.99, r + return_offset)

    deaths = [p["birthYear"] + p["planningAge"] + 1 for p in people]
    first_death = min(deaths)
    first_death_year = first_death if first_death <= last else None

    # ---- Social Security inputs (§7.5)
    def claim_factor(birth_year: int, claim_months: int) -> float:
        fra = st_fra_months(birth_year)
        m = fra - claim_months
        if m > 0:
            return 1.0 - (ST_EARLY[0] * min(m, 36) + ST_EARLY[1] * max(0, m - 36))
        if m < 0:
            return 1.0 + ST_DELAYED * min(-m, ST_DELAYED_MAX_AGE * 12 - fra)
        return 1.0

    ss_in = []
    for k, p in enumerate(people):
        s = p["socialSecurity"]
        src = s["source"]
        ca = s["claimAge"]
        info = {
            "kind": src["kind"],
            "pia": None,
            "monthly": 0.0,
            "claimMonths": ca["years"] * 12 + ca["months"],
            "claimYear": p["birthYear"] + ca["years"],
            "firstMonths": max(0, 12 - (p["birthMonth"] - 1 + ca["months"])),
        }
        if src["kind"] == "atClaimAge":
            info["monthly"] = d(src["monthlyAtClaim"])  # today's dollars, no rule values needed
        elif src["kind"] == "statement":
            if V:
                info["pia"] = d(src["piaMonthly"])
                info["monthly"] = info["pia"] * claim_factor(p["birthYear"], info["claimMonths"])
            else:
                excluded.add("socialSecurityClaiming")
                info["kind"] = "excluded"
        elif src["kind"] != "none":
            if V:
                raise Unsupported("illustrative PIA estimator")
            excluded.add("socialSecurityClaiming")
            info["kind"] = "excluded"
        ss_in.append(info)

    def ss_claimed_by(k: int, year: int) -> bool:
        i = ss_in[k]
        return year > i["claimYear"] or (year == i["claimYear"] and i["firstMonths"] > 0)

    def ss_months(k: int, year: int) -> int:
        i = ss_in[k]
        if year < i["claimYear"]:
            return 0
        return i["firstMonths"] if year == i["claimYear"] else 12

    paid = lambda i: i["kind"] in ("atClaimAge", "statement")  # noqa: E731
    if couple and not V and any(paid(i) or i["kind"] == "excluded" for i in ss_in):
        # Spousal and survivor amounts need verified SSA rules (§7.5): left out and labeled.
        if first_death_year is not None or all(i["kind"] in ("statement", "excluded") for i in ss_in):
            excluded.add("spousalSurvivorBenefits")
    if V and couple and any(i["kind"] == "atClaimAge" for i in ss_in) and any(paid(i) for i in ss_in):
        # Spousal is "excluded" for atClaimAge inputs (no PIA); whether that is listed is not documented.
        if not all(i["kind"] == "atClaimAge" for i in ss_in) or first_death_year is None:
            raise Unsupported("fixture-rule couple mixing atClaimAge with other SS inputs")

    # Survivor (§7.5): the deceased's benefit, as if claimed at the death age if not yet claimed.
    survivor_monthly = None
    if V and couple and first_death_year is not None:
        dk = deaths.index(first_death)
        sk = 1 - dk
        di, si = ss_in[dk], ss_in[sk]
        if paid(di):
            if not paid(si) and si["kind"] != "none":
                raise Unsupported("survivor with an unmodeled own benefit")
            if si["kind"] == "none" or not ss_claimed_by(sk, first_death - 1):
                raise Unsupported("survivor who has not claimed before the first death year")
            if ss_claimed_by(dk, first_death - 1):
                ben_d = di["monthly"]
            elif di["kind"] == "statement":
                death_age = first_death - people[dk]["birthYear"]
                if death_age < 62:
                    raise Unsupported("death before age 62 with an unclaimed benefit")
                # Unclaimed at death: the PIA, plus any delayed credits earned (never reduced).
                ben_d = di["pia"] * max(1.0, claim_factor(people[dk]["birthYear"], death_age * 12))
            else:
                ben_d = di["monthly"]  # atClaimAge stands in for the benefit at the death age
            surv = max(si["monthly"], ST_SURVIVOR_SHARE * ben_d)
            if di["pia"] is not None:
                surv = max(surv, ST_SURVIVOR_FLOOR * di["pia"])
            survivor_monthly = (sk, surv)

    def ss_index(t: int, price: float) -> float:
        if ss_cola["mode"] == "inflation":
            return price
        return (1.0 + ss_cola["rate"]) ** (t - 1)

    rows = []
    price = 1.0
    prices = {}
    retirement_year = None
    retirement_t = None
    depletion_year = None
    infeasible_years: list[int] = []

    for t in range(1, n_years + 1):
        year = y1 + t - 1
        if t >= 2:
            price *= 1.0 + inflation
        prices[year] = price
        R = resolve_year(year, inflation) if V else None

        # ---- people: ages, status, compensation (§1.4, §3.1)
        prow = []
        for k, p in enumerate(people):
            e = emps[k]
            age = year - p["birthYear"]
            alive = age <= p["planningAge"]
            retired = age >= p["retirementAge"]
            base = bonus = 0.0
            working = False
            pt = 0.0
            if e is not None:
                if t == 1:
                    g = 0.0
                    b_now = d(e["baseSalary"])
                else:
                    if year in e["raiseOverrides"]:
                        g = e["raiseOverrides"][year]
                    elif e["raise"]["mode"] == "nominal":
                        g = e["raise"]["rate"]
                    else:
                        g = (1.0 + inflation) * (1.0 + e["raise"]["realRate"]) - 1.0
                    b_now = base_prev[k] * (1.0 + g)
                base_prev[k] = b_now
                bk = e["bonus"]
                if bk["kind"] == "none":
                    bon_now = 0.0
                elif bk["kind"] == "percentOfSalary":
                    bon_now = bk["pct"] * b_now
                else:
                    if t == 1:
                        bon_now = d(bk["amount"])
                    else:
                        gm = e["bonusGrowth"]
                        if gm["mode"] == "withSalary":
                            bon_now = bonus_prev[k] * (1.0 + g)
                        elif gm["mode"] == "ownRate":
                            bon_now = bonus_prev[k] * (1.0 + gm["rate"])
                        else:
                            bon_now = bonus_prev[k]
                bonus_prev[k] = bon_now
                stop = e["stopAge"] if e["stopAge"] is not None else p["retirementAge"]
                working = alive and age < stop
                if working:
                    base, bonus = b_now, bon_now
                ptp = e["partTime"]
                # §1.4: part-time pay stops from the person's death year.
                if ptp is not None and alive and ptp["startAge"] <= age < ptp["endAge"]:
                    pt = d(ptp["annualIncome"]) * price
            prow.append(
                # §1.4: retired = at or past the retirement age and drawing no salary.
                {
                    "age": age,
                    "alive": alive,
                    "retired": retired and not working,
                    "working": working,
                    "base": base,
                    "bonus": bonus,
                    "pt": pt,
                    "ss": 0.0,
                    "pension": 0.0,
                    "catchUp": 0.0,
                }
            )

        phase = "retirement" if all(r["retired"] for r in prow if r["alive"]) else "accumulation"
        if phase == "retirement" and retirement_year is None:
            retirement_year = year
            retirement_t = t
        living = [k for k in range(len(people)) if prow[k]["alive"]]
        status = "marriedFilingJointly" if mfj and (first_death_year is None or year <= first_death_year) else "single"
        # Filers on the return (§7.1): the living, plus a spouse who died this year on the joint return.
        filer_ages = [
            prow[k]["age"]
            for k in range(len(people))
            if prow[k]["alive"]
            or (status == "marriedFilingJointly" and year == people[k]["birthYear"] + people[k]["planningAge"] + 1)
        ]
        someone_working = any(prow[k]["working"] or prow[k]["pt"] > 0 for k in living)
        if couple and first_death_year is not None and year >= first_death_year and phase == "accumulation":
            raise Unsupported("a death during the accumulation phase (survivor spending reduction scope)")

        # ---- returns and growth factors (§1.5, §1.6, §4)
        g_net, g_gross, applied = {}, {}, {}
        for x in accounts:
            r = account_return(x, phase, year)
            applied[x["id"]] = r
            rho = (1.0 + r) * (1.0 - x.get("expenseRatio", 0.0)) - 1.0
            if x["type"] == "taxableBrokerage":
                rho -= drag
            g_net[x["id"]] = factors(rho, timing, granularity)
            g_gross[x["id"]] = factors(r, timing, granularity)

        # ---- workplace contributions (§3.2-3.5; before limits with the bundled rules, §1.7)
        contrib = {x["id"]: 0.0 for x in accounts}
        employer = {x["id"]: 0.0 for x in accounts}
        forfeit = {x["id"]: 0.0 for x in accounts}
        employee_contrib = 0.0
        pre_tax = 0.0
        for k, p in enumerate(people):
            e = emps[k]
            pr = prow[k]
            pr.update({"eDef": 0.0, "eMatch": 0.0, "dT": 0.0, "dR": 0.0, "match": 0.0, "flatC": 0.0})
            if pr["working"]:
                # §3.2 eligible pay is per person (plan-independent), before L^comp.
                pr["eDef"] = pr["base"] + (pr["bonus"] if e["bonusCountsForDeferrals"] else 0.0)
                pr["eMatch"] = pr["base"] + (pr["bonus"] if e["bonusCountsForMatch"] else 0.0)
            if V and len(plans[k]) > 1:
                raise Unsupported("two plans per person with verified limits (aggregation)")
            for j, pl in enumerate(plans[k]):
                st = plan_state[k][j]
                dest = pl["rothAccountId"] if pl["dest"] == "roth" else pl["traditionalAccountId"]
                if not pr["working"]:
                    if not st["separated"]:
                        # Separation: start of the first year with no salary (§4); forfeit before growth.
                        yos = pl["yos0"] + st["worked"]
                        f = min(bal[dest], unvested[dest] * (1.0 - vested_fraction(pl["vesting"], yos)))
                        forfeit[dest] += f
                        unvested[dest] = 0.0
                        st["separated"] = True
                    continue
                base, bonus = pr["base"], pr["bonus"]
                cfd = e["bonusCountsForDeferrals"]
                cfm = e["bonusCountsForMatch"]
                e_match = base + (bonus if cfm else 0.0)
                p_t, p_r = pl["pTsal"], pl["pRsal"]
                auto = pl["auto"]
                if auto is not None:
                    p1 = p_t if auto["appliesTo"] == "traditional" else p_r
                    # ASSUMPTION: escalation steps the salary percentage by projection year index.
                    pt_ = p1 if p1 >= auto["capPct"] else min(auto["capPct"], p1 + auto["stepPct"] * (t - 1))
                    if auto["appliesTo"] == "traditional":
                        p_t = pt_
                    else:
                        p_r = pt_
                d_t_f = p_t * base + (pl["pTbon"] * bonus if cfd else 0.0)
                d_r_f = p_r * base + (pl["pRbon"] * bonus if cfd else 0.0)
                # §1.3: contribution amounts are whole cents. Deferrals are rounded per bucket; the match
                # is computed on the eligible pay and total deferral in cents, then rounded.
                d_t = whole_cents(d_t_f)
                d_r = whole_cents(d_r_f)
                catch_up = 0.0
                if V:
                    l_comp = R["compensationLimit"]
                    if pr["eDef"] > l_comp:
                        raise Unsupported("deferral pay above the 401(a)(17) limit (pro rata scaling)")
                    e_match = min(e_match, l_comp)
                    l402 = R["electiveDeferral"]
                    age = pr["age"]
                    cu = R["catchUp60to63"] if 60 <= age <= 63 else (R["catchUp50"] if age >= 50 else 0.0)
                    req = d_t + d_r
                    allowed = l402 + cu
                    if req > allowed + 1e-9:
                        # §3.4: both buckets are scaled pro rata to fit, with a warning.
                        if d_t > 0 and d_r > 0:
                            raise Unsupported("pro rata scaling of two deferral buckets (cent split)")
                        d_t = allowed if d_t > 0 else 0.0
                        d_r = allowed if d_r > 0 else 0.0
                        warnings.add("deferralCapped")
                    catch_up = max(0.0, d_t + d_r - l402)
                    if catch_up > 0 and R["rothCatchUpInForce"]:
                        prior = prior_fica_wages[k]
                        if prior is None or prior > R["rothCatchUpWageThreshold"]:
                            raise Unsupported("Roth catch-up rule binding or prior-year wages unknown")
                    deferral = whole_cents(d_t + d_r)
                    m = match_amount(pl["tiers"], pl["cap"], deferral, whole_cents(e_match))
                    if catch_up > 0 and abs(m - match_amount(pl["tiers"], pl["cap"], deferral - catch_up, whole_cents(e_match))) > 1e-9:
                        raise Unsupported("whether the catch-up counts for the match is not documented")
                    m = whole_cents(m)
                    flat = whole_cents(pl["flat"] * whole_cents(e_match))
                    # §3.4 415(c): employee (excluding catch-up) + employer <= min(L415, compensation).
                    l415 = min(R["annualAdditions"], base + bonus)
                    emp_part = d_t + d_r - catch_up
                    if emp_part > l415:
                        raise Unsupported("415(c) binding on the employee portion")
                    over = emp_part + m + flat - l415
                    if over > 1e-9:
                        cut = min(m, over)
                        m -= cut
                        flat -= over - cut
                        warnings.add("annualAdditionsCapped")
                else:
                    e_match = whole_cents(e_match)
                    deferral = whole_cents(d_t_f + d_r_f)
                    m = whole_cents(match_amount(pl["tiers"], pl["cap"], deferral, e_match))
                    flat = whole_cents(pl["flat"] * e_match)
                    excluded.add("workplaceLimits")
                contrib[pl["traditionalAccountId"]] += d_t
                if d_r > 0:
                    contrib[pl["rothAccountId"]] += d_r
                contrib[dest] += m + flat
                employer[dest] += m + flat
                pr["dT"] += d_t
                pr["dR"] += d_r
                pr["match"] += m
                pr["flatC"] += flat
                pr["catchUp"] += catch_up
                employee_contrib += d_t + d_r
                pre_tax += d_t
                st["worked"] += 1

        # ---- scheduled contributions (§3.6, §3.7; requested amounts with the bundled rules, §1.7)
        def requested(x: dict, k: int) -> float | None:
            s = x["contribution"]
            amt = s["amount"]
            if amt["kind"] == "dollars":
                v = d(amt["amount"]) * (12 if amt["frequency"] == "monthly" else 1)
                gm = s.get("growth", {"mode": "flat"})
                if gm["mode"] == "inflation":
                    v *= price
                elif gm["mode"] == "rate":
                    v *= (1.0 + gm["rate"]) ** (t - 1)
                return v
            if amt["kind"] == "percentOfSalary":
                return amt["pct"] * prow[k]["base"]
            return None  # maxAllowed

        sched = {}
        active = []
        for x in accounts:
            s = x.get("contribution")
            if s is None or x["type"] in ("workplaceTraditional", "workplaceRoth"):
                continue
            k = person_idx[x["ownerId"]]
            start = s.get("startYear") if s.get("startYear") is not None else y1
            stop = s.get("stopYear") if s.get("stopYear") is not None else last_working_year(k)
            if start <= year <= stop:
                active.append((x, k))
        if V:
            if phase == "retirement" and active:
                raise Unsupported("retirement-phase scheduled contributions with verified taxes")
            earned = [prow[k]["base"] + prow[k]["bonus"] + prow[k]["pt"] for k in range(len(people))]
            hsa_room: dict[int, float] = {}
            hsa_total = [0.0] * len(people)
            for x, k in active:  # 1. HSAs, one limit per person (coverage of the person's first HSA)
                if x["type"] != "hsa":
                    continue
                if not x["hdhpAttested"]:
                    continue
                if k not in hsa_room:
                    first = next(y for y in accounts if y["type"] == "hsa" and y["ownerId"] == x["ownerId"])
                    lim = R["hsa.selfOnly"] if first["coverage"] == "selfOnly" else R["hsa.family"]
                    hsa_room[k] = lim + (R["hsa.catchUp55"] if prow[k]["age"] >= 55 else 0.0)
                req = requested(x, k)
                v = hsa_room[k] if req is None else min(req, hsa_room[k])
                if req is not None and req > hsa_room[k] + 1e-9:
                    warnings.add("hsaCapped")
                v = whole_cents(v)
                hsa_room[k] -= v
                hsa_total[k] += v
                if v > 0:
                    sched[x["id"]] = v
            ira_room: dict[int, float] = {}
            ira_other = [0.0] * len(people)

            def ira_base(k: int) -> float:
                lim = R["iraLimit"] + (R["iraCatchUp50"] if prow[k]["age"] >= 50 else 0.0)
                return min(lim, earned[k])

            for x, k in active:  # 2. traditional IRAs (shared limit, account order)
                if x["type"] != "traditionalIra":
                    continue
                ira_room.setdefault(k, ira_base(k))
                req = requested(x, k)
                v = ira_room[k] if req is None else min(req, ira_room[k])
                if req is not None and req > ira_room[k] + 1e-9:
                    warnings.add("iraCapped")
                v = whole_cents(v)
                ira_room[k] -= v
                ira_other[k] += v
                if v > 0:
                    sched[x["id"]] = v
            for x, k in active:  # 3-4. Roth IRA eligibility per owner, then Roth IRA schedules
                if x["type"] != "rothIra":
                    continue
                if x.get("magiOverride") is not None:
                    magi = d(x["magiOverride"])
                else:
                    who = range(len(people)) if mfj else [k]
                    magi = sum(
                        prow[q]["base"] + prow[q]["bonus"] - prow[q]["dT"] - hsa_total[q] + prow[q]["pt"] for q in who
                    )
                lo, hi = R[f"rothPhaseOut.{status}"]
                b = ira_base(k)
                if magi <= lo:
                    phased = b
                elif magi >= hi:
                    phased = 0.0
                    warnings.add("rothIraIneligible")
                else:
                    inc, minimum = ST_ROTH_ROUNDING
                    phased = math.ceil(b * (hi - magi) / (hi - lo) / inc - 1e-9) * inc
                    if phased > 0:
                        phased = max(phased, minimum)
                    warnings.add("rothIraPhaseOutReduced")
                allowed = max(0.0, min(phased, b - ira_other[k]))
                req = requested(x, k)
                v = allowed if req is None else min(req, allowed)
                v = whole_cents(v)
                ira_other[k] += v
                if v > 0:
                    sched[x["id"]] = v
            for x, k in active:  # 5. taxable and cash accounts (no limit)
                if x["type"] not in ("taxableBrokerage", "cash"):
                    continue
                req = requested(x, k)
                v = whole_cents(0.0 if req is None else req)
                if v > 0:
                    sched[x["id"]] = v
            pre_tax += sum(hsa_total)
        else:
            for x, k in active:
                if x["type"] == "hsa" and not x["hdhpAttested"]:
                    continue
                if x["type"] == "hsa":
                    excluded.add("hsaLimits")
                elif x["type"] in ("traditionalIra", "rothIra"):
                    excluded.add("iraLimits")
                req = requested(x, k)
                # maxAllowed: the limit is unknown (IRA/HSA) or there is none (taxable/cash): nothing.
                v = whole_cents(0.0 if req is None else req)
                if v > 0:
                    sched[x["id"]] = v

        # ---- other income (§3.8, §7.6): owned income stops after the owner's death (§1.4)
        other = 0.0
        other_taxable = 0.0
        for inc in h.get("otherIncome", []):
            end_y = inc.get("endYear")
            owner_k = person_idx.get(inc.get("ownerId")) if inc.get("ownerId") is not None else None
            if owner_k is not None and not prow[owner_k]["alive"]:
                continue
            if inc["startYear"] <= year and (end_y is None or year <= end_y):
                v = d(inc["annualAmount"])
                gm = inc.get("growth", {"mode": "inflation"})
                if gm["mode"] == "inflation":
                    v *= price
                elif gm["mode"] == "rate":
                    v *= (1.0 + gm["rate"]) ** (t - 1)
                other += v
                other_taxable += inc.get("taxableFraction", 1.0) * v

        # ---- Social Security (§7.5)
        idx = ss_index(t, price)
        red = (1.0 - ss_red["reduction"]) if ss_red is not None and year >= ss_red["fromYear"] else 1.0
        for k in living:
            i = ss_in[k]
            if not paid(i):
                continue
            months = ss_months(k, year)
            monthly = i["monthly"]
            if survivor_monthly is not None and survivor_monthly[0] == k and year >= first_death:
                months, monthly = 12, survivor_monthly[1]
            elif V and couple and len(living) == 2 and all(j["kind"] == "statement" for j in ss_in):
                o = 1 - k
                if ss_claimed_by(k, year) and ss_claimed_by(o, year):
                    if ss_months(k, year) < 12 or ss_months(o, year) < 12:
                        raise Unsupported("spousal excess in a partial claim year")
                    excess = max(0.0, ST_SPOUSAL[0] * ss_in[o]["pia"] - i["pia"])
                    m = st_fra_months(people[k]["birthYear"]) - i["claimMonths"]
                    if m > 0:
                        excess *= 1.0 - (ST_SPOUSAL[1] * min(m, 36) + ST_SPOUSAL[2] * max(0, m - 36))
                    monthly = monthly + excess
            prow[k]["ss"] = months * monthly * idx * red
            fra = st_fra_months(people[k]["birthYear"]) if V else 67 * 12
            if prow[k]["ss"] > 0 and i["claimMonths"] < fra and (prow[k]["base"] > 0 or prow[k]["pt"] > 0):
                warnings.add("ssClaimBeforeFraWhileWorking")
        ss_total = sum(r["ss"] for r in prow)

        # ---- pensions (§7.6)
        deposits = {x["id"]: 0.0 for x in accounts}  # lump sums and one-time inflows (mid-year)
        deposit_basis = {x["id"]: 0.0 for x in accounts}
        inflow_total = 0.0
        ordinary_extra = 0.0  # ordinary income from lump sums and one-time inflows
        ltcg_extra = 0.0
        pension_taxable = 0.0
        survivor_pension_paid = False
        for pn in pensions:
            k = person_idx[pn["ownerId"]]
            start_year = people[k]["birthYear"] + pn["startAge"]
            if year < start_year:
                continue
            frac = pn.get("taxableFraction", 1.0)
            if pn["payout"]["kind"] == "lumpSum":
                if year == start_year:
                    if not prow[k]["alive"]:
                        raise Unsupported("lump sum after the owner's death")
                    amt = d(pn["payout"]["amount"])
                    dest = pn["payout"]["destinationAccountId"]
                    deposits[dest] += amt
                    deposit_basis[dest] += amt
                    inflow_total += amt
                    if TAX_TREATMENT[acct_by_id[dest]["type"]] != "taxDeferred":
                        ordinary_extra += frac * amt  # a rollover into a tax-deferred account is untaxed
                    if acct_by_id[dest]["type"] == "rothIra":
                        raise Unsupported("lump sum into a Roth IRA (basis)")
                continue
            if deaths[k] <= start_year:
                raise Unsupported("pension owner dies before the start age")
            cola = pn.get("cola", {"mode": "flat"})
            basis_mode = pn["amountBasis"]
            if start_year < y1:
                if basis_mode == "nominalAtStart" and cola["mode"] == "flat":
                    amt = d(pn["annualAmount"])
                elif basis_mode == "todaysDollars" and cola["mode"] == "inflation":
                    amt = d(pn["annualAmount"]) * price
                else:
                    raise Unsupported("pension started before year 1 with this basis/COLA")
            else:
                p_s = prices[start_year]
                amt0 = d(pn["annualAmount"]) * (p_s if basis_mode == "todaysDollars" else 1.0)
                if cola["mode"] == "flat":
                    amt = amt0
                elif cola["mode"] == "inflation":
                    amt = amt0 * price / p_s
                else:
                    amt = amt0 * (1.0 + cola["rate"]) ** (year - start_year)
            if prow[k]["alive"]:
                prow[k]["pension"] += amt
                pension_taxable += frac * amt
            elif couple and prow[1 - k]["alive"]:
                # Which person row carries a survivor continuation is not documented, so the
                # per-person `pension` figures are left out of the expectation that year (the
                # household total `flows.pensions` is compared).
                v = amt * pn.get("survivorFraction", 1.0)
                prow[1 - k]["pension"] += v
                pension_taxable += frac * v
                survivor_pension_paid = True
        pension_total = sum(r["pension"] for r in prow)

        # ---- one-time events (§7.6)
        outflows = 0.0
        for ev in events:
            if ev["year"] != year:
                continue
            amt = d(ev["amount"]) * (price if ev["amountBasis"] == "todaysDollars" else 1.0)
            if ev["direction"] == "outflow":
                outflows += amt
                continue
            dest = ev.get("destinationAccountId")
            if dest is None and surplus_cfg["mode"] == "account":
                dest = surplus_cfg["accountId"]
            if dest is None:
                dest = first_taxable or first_cash
            treat = ev.get("taxTreatment", "none")
            if treat == "ordinaryIncome":
                ordinary_extra += amt
            elif treat == "capitalGain":
                ltcg_extra += ev.get("gainFraction", 0.0) * amt
            inflow_total += amt
            if dest is None:
                warnings.add("oneTimeInflowSpent")  # ASSUMPTION: still counted in oneTimeInflows
                continue
            if acct_by_id[dest]["type"] == "rothIra":
                raise Unsupported("one-time inflow into a Roth IRA (basis)")
            deposits[dest] += amt
            # ASSUMPTION: "basis equal to the after-gain amount" = the whole deposit (gain realized now).
            deposit_basis[dest] += amt

        # ---- spending need (§5)
        if phase == "retirement":
            age1 = year - people[0]["birthYear"]
            s_step = d(sp["retirementAnnualSpending"])
            for stp in steps:
                if stp["fromAge"] <= age1:
                    s_step = d(stp["annualSpending"])
            spend = s_step * (1.0 + glide) ** (t - retirement_t) * price
            if any(prow[k]["retired"] and prow[k]["age"] < 65 for k in living):
                spend += healthcare * price
            if couple and first_death_year is not None and year >= first_death_year:
                # ASSUMPTION: the reduction applies to the whole need, healthcare line included.
                spend *= 1.0 - survivor_reduction
        else:
            spend = d(sp["currentAnnualSpending"]) * price
        need = spend + outflows

        # ---- forfeitures at the start of the year, caps (§4, §1.5)
        start_bal = dict(bal)
        s_after = {k2: bal[k2] - forfeit[k2] for k2 in bal}
        part_time = sum(r["pt"] for r in prow)
        wages_by_person = [r["base"] + r["bonus"] + r["pt"] for r in prow]
        wages_total = sum(wages_by_person)
        fixed_cash = part_time + ss_total + pension_total + other  # §7.1 step 2 (retirement)

        if phase == "retirement" and not V:
            # §4.1 step 3: scheduled contributions only from the income left after the need.
            req = sum(sched.values())
            avail = max(0.0, fixed_cash - need)
            if req > avail + 1e-9:
                scale = avail / req if req > 0 else 0.0
                # §1.3: scaled amounts round down to whole cents so they never exceed the income left over.
                sched = {k2: math.floor(v * scale * 100 + 1e-9) / 100 for k2, v in sched.items()}
                warnings.add("retirementContributionsReduced")
        for k2, v in sched.items():
            contrib[k2] += v
            employee_contrib += v
        for k2, v in deposits.items():
            contrib[k2] += v

        caps = {
            x["id"]: withdrawal_cap(s_after[x["id"]], contrib[x["id"]], g_net[x["id"]], timing, granularity)
            for x in accounts
        }
        wd = {x["id"]: 0.0 for x in accounts}
        rmd = {x["id"]: 0.0 for x in accounts}

        # ---- RMDs (§7.1 step 3): verified rules only
        rmd_total = 0.0
        for x in accounts:
            if TAX_TREATMENT[x["type"]] != "taxDeferred" and not (x["type"] == "workplaceRoth" and ST_ROTH401K_RMD):
                continue
            k = person_idx[x["ownerId"]]
            gk = k if prow[k]["alive"] else (1 - k if couple and prow[1 - k]["alive"] else None)
            if gk is None:
                continue  # §7.7: the survivor's age governs RMDs on the deceased's accounts
            if not V:
                if prow[gk]["age"] >= 75 and start_bal[x["id"]] > 0:
                    excluded.add("rmd")
                continue
            if prow[gk]["age"] < st_rmd_start_age(people[gk]["birthYear"]):
                continue
            v = min(caps[x["id"]], start_bal[x["id"]] / st_ult_period(prow[gk]["age"]))
            if v > 0:
                rmd[x["id"]] = v
                wd[x["id"]] += v
                rmd_total += v
        if rmd_total > 0 and phase == "accumulation":
            raise Unsupported("RMDs in the accumulation phase (net pay vs reinvestment)")
        caps_after = {i: max(0.0, caps[i] - wd[i]) for i in caps}

        hsa_med = 0.0
        shortfall = 0.0
        reinvest = 0.0
        surplus_routed = 0.0
        tax = None
        solver_converged = None
        net_income = None
        net_pay = None
        surplus = None
        infeasible = None
        strat = {x["id"]: 0.0 for x in accounts}

        def tax_of(strat_wd: dict) -> dict:
            other_ord = other_taxable + pension_taxable + ordinary_extra + rmd_total
            ltcg = ltcg_extra
            for x in accounts:
                w = strat_wd[x["id"]]
                if w <= 0:
                    continue
                grp = WITHDRAWAL_GROUP[x["type"]]
                if grp == "traditional":
                    other_ord += w
                elif grp == "hsa":
                    other_ord += w  # non-medical HSA withdrawals: ordinary income (§6, §7.4)
                elif grp == "taxable":
                    i = x["id"]
                    ltcg += w * (1.0 - (basis[i] + deposit_basis[i] + sched.get(i, 0.0)) / caps[i])
            return compute_tax(
                R, status, filer_ages, wages_by_person, pre_tax, other_ord, ss_total, ltcg, state_rate
            )

        def allocate(amount: float) -> tuple[dict, float]:
            if strategy == "bracketFill" and V:
                trad_ids = [x["id"] for x in accounts if WITHDRAWAL_GROUP[x["type"]] == "traditional"]
                trad_cap = sum(caps_after[i] for i in trad_ids)
                take = min(amount, fill_room, trad_cap)
                out = {x["id"]: 0.0 for x in accounts}
                for i in trad_ids:
                    if trad_cap > 0:
                        out[i] = take * caps_after[i] / trad_cap
                rest, left = draw(amount - take, caps_after, accounts, BRACKET_FILL_REST)
                for i in rest:
                    out[i] += rest[i]
                if left > 0.005 and trad_cap - take > 0.005:
                    raise Unsupported("bracket fill after every non-traditional account is empty")
                return out, left
            return draw(amount, caps_after, accounts, STRATEGY_ORDER[strategy])

        if strategy == "bracketFill" and not V:
            warnings.add("withdrawalStrategyFallback")

        if phase == "retirement":
            if V:
                if fill_rate is None and strategy == "bracketFill":
                    raise Unsupported("bracket fill without a top rate")
                fixed = fixed_cash + rmd_total
                # §7.1 step 4: HSA qualified medical withdrawals, tax-free, pro rata by the HSAs' caps.
                # ASSUMPTION (verified path): "remaining need" is the need less the gross fixed income.
                hsa_ids = [x["id"] for x in accounts if x["type"] == "hsa"]
                hsa_cap = sum(caps_after[i] for i in hsa_ids)
                want = medical * price
                if want > 0 and need - fixed < want:
                    raise Unsupported("HSA medical limited by the remaining need under verified taxes")
                hsa_med = min(want, max(0.0, need - fixed), hsa_cap)
                for i in hsa_ids:
                    if hsa_cap > 0:
                        v = hsa_med * caps_after[i] / hsa_cap
                        wd[i] += v
                        caps_after[i] -= v
                fill_room = 0.0
                if strategy == "bracketFill":
                    br = R[f"brackets.{status}"]
                    tops = [br[i + 1][1] for i, (rate, _) in enumerate(br[:-1]) if abs(rate - fill_rate) < 1e-12]
                    if not tops:
                        raise Unsupported("bracket fill top rate is not a bracket below the top")
                    t0 = tax_of({x["id"]: 0.0 for x in accounts})
                    ordinary_fixed = t0["ordinaryBeforeDeduction"] - t0["taxableSocialSecurity"]
                    fill_room = max(0.0, tops[0] + t0["deductions"] - ordinary_fixed - t0["taxableSocialSecurity"])
                total_cap = sum(caps_after.values())
                base_in = fixed + hsa_med
                # §7.2 bounded fixed point.
                zero = {x["id"]: 0.0 for x in accounts}
                w_k = max(0.0, need - base_in + tax_of(zero)["totalTax"])
                converged = False
                for _ in range(max_iter):
                    alloc, _left = allocate(w_k)
                    w_next = max(0.0, need + tax_of(alloc)["totalTax"] - base_in)
                    done = abs(w_next - w_k) <= tol
                    w_k = w_next
                    if done:
                        converged = True
                        break
                if not converged:
                    warnings.add("grossUpNotConverged")
                strat, left = allocate(w_k)
                capped = w_k > total_cap + 1e-9
                tx = tax_of(strat)
                drawn = sum(strat.values())
                gross = base_in + drawn
                net = cents(gross) / 100 - tx["totalTax"]  # §7.2: netIncome = grossIncome − totalTax
                if drawn <= 0 and net > need:
                    reinvest = net - cents(need) / 100  # §7.1 step 6, after tax
                if capped:
                    shortfall = max(0.0, need - net)
                tax = tx
                solver_converged = converged
                net_income = net
            else:
                remaining = need + sum(sched.values()) - fixed_cash
                hsa_ids = [x["id"] for x in accounts if x["type"] == "hsa"]
                hsa_cap = sum(caps_after[i] for i in hsa_ids)
                hsa_med = min(medical * price, max(0.0, remaining), hsa_cap)
                for i in hsa_ids:
                    if hsa_cap > 0:
                        v = hsa_med * caps_after[i] / hsa_cap
                        wd[i] += v
                        caps_after[i] -= v
                strat, shortfall = draw(max(0.0, remaining - hsa_med), caps_after, accounts, STRATEGY_ORDER[strategy])
                if remaining < 0:
                    reinvest = -remaining  # §7.1 step 6 before taxes
                gross = fixed_cash + hsa_med + sum(strat.values())
                excluded.add("federalIncomeTax")
        else:
            # Accumulation (§3.8, §7.1 step 5): spending is funded from pay; one-time outflows are
            # withdrawn from the portfolio by the strategy, before taxes.
            strat, shortfall = draw(outflows, caps_after, accounts, STRATEGY_ORDER[strategy])
            if V and any(strat[x["id"]] > 0 and x["type"] != "cash" for x in accounts):
                raise Unsupported("taxation of an accumulation-phase outflow withdrawal")
            if V and strategy == "bracketFill" and outflows > 0:
                raise Unsupported("bracket fill order for an accumulation-phase outflow")
            gross = wages_total + other + ss_total + pension_total  # ASSUMPTION: SS and pensions included
            if V:
                if not someone_working:
                    raise Unsupported("accumulation year with nobody working")
                tax = tax_of(strat)
                net_pay = cents(gross) - cents(tax["totalTax"])
                surplus = net_pay - cents(employee_contrib) - cents(spend)
                infeasible = surplus < 0
                if surplus > 0 and surplus_cfg["mode"] == "account":
                    dest = surplus_cfg["accountId"]
                    if strat[dest] > 0:
                        raise Unsupported("surplus into an account with withdrawals the same year")
                    surplus_routed = surplus / 100
                    contrib[dest] += surplus_routed
                    deposit_basis[dest] += surplus_routed
                net_income = net_pay / 100
            else:
                excluded.add("federalIncomeTax")
                # §3.8: taxes and contributions are never negative, so gross income below spending
                # proves the year infeasible even before taxes.
                if someone_working and gross - spend < -0.005:
                    infeasible = True
            if infeasible:
                infeasible_years.append(year)
                warnings.add("savingsPlanInfeasible")

        for i in strat:
            wd[i] += strat[i]
        if reinvest > 0:
            reinvest = whole_cents(reinvest)
            if reinvest_dest is not None:
                if wd[reinvest_dest] > 0:
                    raise Unsupported("reinvestment into an account with withdrawals the same year")
                contrib[reinvest_dest] += reinvest
                deposit_basis[reinvest_dest] += reinvest
            else:
                reinvest = 0.0  # spent

        # Roth IRA and HSA flags (§7.4)
        for x in accounts:
            i = x["id"]
            k = person_idx[x["ownerId"]]
            gk = k if prow[k]["alive"] else 1 - k
            if x["type"] == "rothIra" and strat[i] > 0:
                earnings = strat[i] - (basis[i] + contrib[i])
                if earnings > 0.005:
                    if V:
                        p = people[gk]
                        first = x.get("firstContributionYear") or y1
                        y595 = p["birthYear"] + (p["birthMonth"] - 1 + ST_ROTH_QUALIFIED_AGE_MONTHS) // 12
                        if gk != k:
                            raise Unsupported("Roth qualification on a deceased owner's account")
                        if not (year >= y595 and year >= first + ST_ROTH_FIVE_YEARS):
                            warnings.add("rothEarningsWithdrawnEarly")
                    else:
                        excluded.add("rothQualification")
            if x["type"] == "hsa" and strat[i] > 0.005 and prow[gk]["age"] < 65:
                warnings.add("hsaNonMedicalPre65")

        # ---- account update
        out_accounts = []
        for x in accounts:
            i = x["id"]
            g_s, g_c, g_w = g_net[i]
            e_net = max(0.0, g_s * s_after[i] + g_c * contrib[i] - g_w * wd[i])
            gs2, gc2, gw2 = g_gross[i]
            e_gross = gs2 * s_after[i] + gc2 * contrib[i] - gw2 * wd[i]
            if x["type"] == "taxableBrokerage":
                # Contributions (scheduled, deposits, reinvested, surplus) add basis 1:1 (§4).
                c0 = basis[i] + sched.get(i, 0.0) + deposit_basis[i]
                basis[i] = max(0.0, c0 * (1.0 - wd[i] / caps[i])) if caps[i] > 0 else c0
            elif x["type"] == "rothIra":
                basis[i] = max(0.0, basis[i] + contrib[i] - wd[i])
            if unvested[i] > 0 or employer[i] > 0:
                unvested[i] = unvested[i] * g_s + employer[i] * g_c
            bal[i] = e_net
            c_start = cents(start_bal[i])
            c_contrib = cents(contrib[i])
            c_wd = cents(wd[i] + forfeit[i])
            c_end = cents(e_net)
            out_accounts.append(
                {
                    "accountId": i,
                    "start": c_start,
                    "contributions": c_contrib,
                    "employerContributions": cents(employer[i]),
                    "feeDrag": cents(e_gross - e_net),
                    "growthNet": c_end - c_start - c_contrib + c_wd,
                    "withdrawals": c_wd,
                    "rmd": cents(rmd[i]),
                    "forfeited": cents(forfeit[i]),
                    "end": c_end,
                    "basisEnd": cents(basis.get(i, 0.0)),
                }
            )

        depleted = shortfall > 0.005
        if depleted:
            warnings.add("portfolioDepleted")
        if depleted and depletion_year is None:
            depletion_year = year
        markers = []
        if year == retirement_year:
            markers.append("retirement")
        if year == first_death_year:
            markers.append("firstDeath")
        if depleted and year == depletion_year:
            markers.append("depletion")

        by_tt = {"taxDeferred": 0, "taxFree": 0, "taxable": 0}
        for x, ao in zip(accounts, out_accounts):
            by_tt[TAX_TREATMENT[x["type"]]] += ao["end"]
        port_end_float = sum(bal.values())
        if phase == "accumulation":
            cash_flow = {
                "netPay": net_pay,
                "employeeContributions": cents(employee_contrib),
                "surplus": surplus,
                "infeasible": infeasible,
            }
        else:
            cash_flow = {"infeasible": None}
        tax_out = None
        if tax is not None:
            tax_out = {
                "filingStatus": status,
                "wages": cents(tax["wages"]),
                "taxableSocialSecurity": cents(tax["taxableSocialSecurity"]),
                "agi": cents(tax["agi"]),
                "deductions": cents(tax["deductions"]),
                "federalOrdinaryTax": cents(tax["federalOrdinaryTax"]),
                "capitalGainsTax": cents(tax["capitalGainsTax"]),
                "ficaSocialSecurity": cents(tax["ficaSocialSecurity"]),
                "ficaMedicare": cents(tax["ficaMedicare"]),
                "stateTax": cents(tax["stateTax"]),
                "totalTax": cents(tax["totalTax"]),
            }
            if solver_converged is not None:
                tax_out["solver"] = {"converged": solver_converged}
        people_out = [
            {
                "personId": p["id"],
                "age": r["age"],
                "alive": r["alive"],
                "retired": r["retired"],
                "baseSalary": cents(r["base"]),
                "bonus": cents(r["bonus"]),
                "partTimeIncome": cents(r["pt"]),
                "eligibleCompForDeferrals": cents(r["eDef"]),
                "eligibleCompForMatch": cents(r["eMatch"]),
                "employeeTraditional": cents(r["dT"]),
                "employeeRoth": cents(r["dR"]),
                "catchUp": cents(r["catchUp"]),
                "employerMatch": cents(r["match"]),
                "employerFlat": cents(r["flatC"]),
                "socialSecurity": cents(r["ss"]),
                "pension": cents(r["pension"]),
            }
            for p, r in zip(people, prow)
        ]
        if survivor_pension_paid:
            for po in people_out:
                del po["pension"]
        rows.append(
            {
                "year": year,
                "phase": phase,
                "deflator": price,
                "people": people_out,
                "accounts": out_accounts,
                # §1.3: household flow totals are sums of the per-account cents (so they reconcile
                # with the account rows); spending figures round the float need once.
                "flows": {
                    "contributions": sum(ao["contributions"] for ao in out_accounts),
                    "employerContributions": sum(ao["employerContributions"] for ao in out_accounts),
                    "feeDrag": sum(ao["feeDrag"] for ao in out_accounts),
                    "withdrawals": sum(ao["withdrawals"] - ao["forfeited"] for ao in out_accounts),
                    "rmd": sum(ao["rmd"] for ao in out_accounts),
                    "hsaMedical": cents(hsa_med),
                    "reinvested": cents(reinvest),
                    "forfeited": sum(ao["forfeited"] for ao in out_accounts),
                    "surplusRouted": cents(surplus_routed),
                    "socialSecurity": cents(ss_total),
                    "pensions": cents(pension_total),
                    "otherIncome": cents(other),
                    "oneTimeInflows": cents(inflow_total),
                    "oneTimeOutflows": cents(outflows),
                    "spendingNeed": cents(need),
                    "spendingFunded": cents(need - shortfall),
                    "shortfall": cents(shortfall),
                },
                "cashFlow": cash_flow,
                "tax": tax_out,
                "totals": {
                    "portfolioStart": sum(ao["start"] for ao in out_accounts),
                    "portfolioEnd": sum(ao["end"] for ao in out_accounts),
                    "byTaxTreatment": by_tt,
                },
                "real": {
                    "portfolioEnd": cents(port_end_float / price),
                    "spendingNeed": cents(need / price),
                    "grossIncome": cents(gross / price),
                    "netIncome": None if net_income is None else cents(net_income / price),
                },
                "grossIncome": cents(gross),
                "netIncome": None if net_income is None else cents(net_income),
                "depleted": depleted,
                "markers": markers,
            }
        )
        for k in range(len(people)):
            prior_fica_wages[k] = wages_by_person[k]

    ending = rows[-1]["totals"]["portfolioEnd"]
    ending_real_float = sum(bal.values()) / price
    summary = {
        "firstYear": y1,
        "lastYear": last,
        "retirementYear": retirement_year,
        "firstDeathYear": first_death_year,
        "depletionYear": depletion_year,
        # §8: the age of the first listed person still alive in the depletion year.
        "depletionAge": next(
            (depletion_year - p["birthYear"] for p in people if depletion_year <= p["birthYear"] + p["planningAge"]),
            None,
        )
        if depletion_year is not None
        else None,
        "endingBalance": ending,
        "endingBalanceReal": cents(ending_real_float),
        "infeasibleYears": infeasible_years,
        "deterministicSuccess": depletion_year is None and ending_real_float >= min_end - 0.005,
    }
    return {
        "rows": rows,
        "summary": summary,
        "warnings": sorted(warnings),
        "excludedFeatures": sorted(excluded),
    }



# --------------------------------------------------------------------------------------------
# Fixture households
# --------------------------------------------------------------------------------------------

Y = CURRENT_YEAR
CMA = {
    "stocks": {"geometricReturn": 0.07, "volatility": 0.16},
    "bonds": {"geometricReturn": 0.045, "volatility": 0.06},
    "cash": {"geometricReturn": 0.03, "volatility": 0.01},
    "correlation": [[1, 0.1, 0], [0.1, 1, 0.2], [0, 0.2, 1]],
    "blendedVolatility": 0.12,
    "note": "Illustrative round-number assumptions chosen by the app authors; not a forecast.",
}
NO_SS = {"source": {"kind": "none"}, "claimAge": {"years": 67, "months": 0}}


def usd(x: float) -> int:
    return int(round(x * 100))


def person(pid: str, birth_year: int, retirement_age: int, planning_age: int, **extra: Any) -> dict:
    p = {
        "id": pid,
        "name": pid.replace("-", " ").title(),
        "birthYear": birth_year,
        "retirementAge": retirement_age,
        "planningAge": planning_age,
        "socialSecurity": NO_SS,
    }
    p.update(extra)
    return p


def acct(kind: str, aid: str, owner: str, balance: float, **extra: Any) -> dict:
    x = {"type": kind, "id": aid, "name": aid.upper(), "ownerId": owner, "balance": usd(balance)}
    if kind in ("workplaceTraditional", "workplaceRoth"):
        x["planType"] = extra.pop("planType", "401k")
    if kind == "taxableBrokerage":
        x["costBasis"] = usd(extra.pop("costBasis", balance))
    if kind == "rothIra":
        x["contributionBasis"] = usd(extra.pop("contributionBasis", balance))
    if kind == "hsa":
        x["coverage"] = extra.pop("coverage", "selfOnly")
        x["hdhpAttested"] = extra.pop("hdhpAttested", False)
    x.update(extra)
    return x


def household(people: list, accounts: list, current: float, retirement: float, **assumptions: Any) -> dict:
    other_income = assumptions.pop("otherIncome", [])
    pensions = assumptions.pop("pensions", [])
    events = assumptions.pop("oneTimeEvents", [])
    spending_extra = assumptions.pop("spending", {})
    a = {
        "inflation": 0.0,
        "returnPreRetirement": 0.06,
        "returnPostRetirement": 0.05,
        "capitalMarket": CMA,
        "rules": {"anchorYear": Y},
    }
    a.update(assumptions)
    h = {
        "id": "household-1",
        "name": "Fixture",
        "filingStatus": "marriedFilingJointly" if len(people) == 2 else "single",
        "people": people,
        "accounts": accounts,
        "spending": {"currentAnnualSpending": usd(current), "retirementAnnualSpending": usd(retirement)},
        "assumptions": a,
    }
    h["spending"].update(spending_extra)
    if other_income:
        h["otherIncome"] = other_income
    if pensions:
        h["pensions"] = pensions
    if events:
        h["oneTimeEvents"] = events
    return h


MATCH_3_2 = [{"matchRate": 1, "bandPctOfPay": 0.03}, {"matchRate": 0.5, "bandPctOfPay": 0.02}]


def strategy_case(strategy: str) -> dict:
    """Retiree (70 → 76) with every withdrawal group; returns differ so caps differ from balances."""
    return household(
        [person("person-1", Y - 70, 65, 76)],
        [
            acct("cash", "cash", "person-1", 10_000, expectedReturn=0.01),
            acct("taxableBrokerage", "taxable", "person-1", 40_000, costBasis=25_000, expectedReturn=0.06),
            acct("traditionalIra", "ira", "person-1", 80_000, expectedReturn=0.05),
            acct("workplaceTraditional", "k401", "person-1", 30_000, expectedReturn=0.03),
            acct("rothIra", "roth", "person-1", 50_000, contributionBasis=20_000, expectedReturn=0.07),
            acct("hsa", "hsa", "person-1", 15_000, expectedReturn=0.04),
        ],
        0,
        45_000,
        inflation=0.02,
        withdrawalStrategy=strategy,
    )


CASES: list[dict] = []


def case(name: str, description: str, h: dict, rules: str = "bundled") -> None:
    CASES.append({"name": name, "description": description, "currentYear": Y, "rules": rules, "household": h})


case(
    "zero-return-zero-inflation-depletion",
    "Retiree, 0% return and 0% inflation: cash then taxable (basis pro rata), exact depletion in year 9.",
    household(
        [person("person-1", Y - 70, 65, 85)],
        [
            acct("cash", "cash", "person-1", 30_000, expectedReturn=0),
            acct("taxableBrokerage", "taxable", "person-1", 70_000, costBasis=35_000, expectedReturn=0),
        ],
        0,
        12_000,
    ),
)

case(
    "accumulation-full-employment",
    "Single worker 40→50, 3% inflation: inflation-plus raise with +10%/0%/−5% overrides, fixed bonus at its"
    " own rate, traditional+Roth deferrals of salary and bonus, auto-escalation, tiered match above every"
    " tier with flat and a binding cap, graded vesting fully vested at separation, return precedence"
    " (phase / allocation / account), expense ratio, % of salary and monthly inflation-grown schedules.",
    household(
        [
            person(
                "person-1",
                Y - 40,
                50,
                60,
                employment={
                    "baseSalary": usd(100_000),
                    "bonus": {"kind": "fixed", "amount": usd(5_000)},
                    "bonusGrowth": {"mode": "ownRate", "rate": 0.04},
                    "raise": {"mode": "inflationPlus", "realRate": 0.01},
                    "raiseOverrides": [
                        {"year": Y + 2, "rate": 0.1},
                        {"year": Y + 3, "rate": 0},
                        {"year": Y + 4, "rate": -0.05},
                    ],
                },
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "rothAccountId": "roth401",
                        "planOffersRoth": True,
                        "traditionalPctOfSalary": 0.06,
                        "traditionalPctOfBonus": 0.1,
                        "rothPctOfSalary": 0.04,
                        "autoEscalation": {"stepPct": 0.01, "capPct": 0.1, "appliesTo": "traditional"},
                        "match": {
                            "tiers": MATCH_3_2,
                            "flatPctOfPay": 0.02,
                            "annualMatchCap": usd(5_000),
                            "vesting": {"kind": "graded", "vestedByYear": [0.25, 0.5, 0.75, 1]},
                            "yearsOfServiceAtStart": 1,
                        },
                    }
                ],
            )
        ],
        [
            acct("workplaceTraditional", "k401", "person-1", 50_000, unvestedEmployerBalance=usd(2_000), expenseRatio=0.005),
            acct("workplaceRoth", "roth401", "person-1", 10_000, allocation={"stocks": 0.6, "bonds": 0.4, "cash": 0}),
            acct(
                "taxableBrokerage",
                "taxable",
                "person-1",
                20_000,
                costBasis=15_000,
                expectedReturn=0.05,
                contribution={"amount": {"kind": "percentOfSalary", "pct": 0.05}},
            ),
            acct(
                "cash",
                "cash",
                "person-1",
                5_000,
                expectedReturn=0.02,
                contribution={
                    "amount": {"kind": "dollars", "amount": usd(200), "frequency": "monthly"},
                    "growth": {"mode": "inflation"},
                    "startYear": Y + 2,
                },
            ),
        ],
        70_000,
        60_000,
        inflation=0.03,
        returnPostRetirement=0.04,
    ),
)

case(
    "bonus-excluded-raise-below-inflation-depletion",
    "Bonus 150% of salary excluded from deferral and match pay (bonus % ignored), 1% raise under 3% inflation,"
    " match above its single tier, then traditional withdrawals deplete mid-retirement.",
    household(
        [
            person(
                "person-1",
                Y - 55,
                60,
                66,
                employment={
                    "baseSalary": usd(60_000),
                    "bonus": {"kind": "percentOfSalary", "pct": 1.5},
                    "bonusCountsForDeferrals": False,
                    "bonusCountsForMatch": False,
                    "raise": {"mode": "nominal", "rate": 0.01},
                },
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "traditionalPctOfSalary": 0.1,
                        "traditionalPctOfBonus": 0.2,
                        "match": {"tiers": [{"matchRate": 0.6, "bandPctOfPay": 0.06}]},
                    }
                ],
            )
        ],
        [
            acct("workplaceTraditional", "k401", "person-1", 0, expectedReturn=0.04),
            acct("cash", "cash", "person-1", 20_000, expectedReturn=0.02),
        ],
        50_000,
        40_000,
        inflation=0.03,
    ),
)

case(
    "couple-vesting-forfeiture-first-death",
    "MFJ couple (60 and 55) retiring in different years: cliff vesting forfeits all unvested money, graded"
    " vesting forfeits 20% into a Roth match destination; bonus counts for deferrals but not match;"
    " part-time and other income; traditionalFirst withdrawals; first death in the horizon.",
    household(
        [
            person(
                "person-1",
                Y - 60,
                62,
                70,
                employment={
                    "baseSalary": usd(120_000),
                    "raise": {"mode": "nominal", "rate": 0.03},
                    "partTime": {"startAge": 62, "endAge": 65, "annualIncome": usd(20_000)},
                },
                workplacePlans=[
                    {
                        "id": "plan-a",
                        "planType": "401k",
                        "traditionalAccountId": "a401",
                        "traditionalPctOfSalary": 0.04,
                        "match": {
                            "tiers": MATCH_3_2,
                            "vesting": {"kind": "cliff", "years": 3},
                            "yearsOfServiceAtStart": 0,
                        },
                    }
                ],
            ),
            person(
                "person-2",
                Y - 55,
                60,
                85,
                employment={
                    "baseSalary": usd(80_000),
                    "bonus": {"kind": "percentOfSalary", "pct": 0.1},
                    "bonusCountsForDeferrals": True,
                    "bonusCountsForMatch": False,
                    "raise": {"mode": "inflationPlus", "realRate": 0.005},
                },
                workplacePlans=[
                    {
                        "id": "plan-b",
                        "planType": "403b",
                        "traditionalAccountId": "b403",
                        "rothAccountId": "b403roth",
                        "planOffersRoth": True,
                        "traditionalPctOfSalary": 0.03,
                        "traditionalPctOfBonus": 0.1,
                        "matchDestination": "roth",
                        "match": {
                            "tiers": MATCH_3_2,
                            "vesting": {"kind": "graded", "vestedByYear": [0, 0.2, 0.4, 0.6, 0.8, 1]},
                            "yearsOfServiceAtStart": 0,
                        },
                    }
                ],
            ),
        ],
        [
            acct("workplaceTraditional", "a401", "person-1", 200_000, unvestedEmployerBalance=usd(1_500)),
            acct("workplaceTraditional", "b403", "person-2", 100_000, planType="403b"),
            acct("workplaceRoth", "b403roth", "person-2", 10_000, planType="403b", unvestedEmployerBalance=usd(500)),
            acct("taxableBrokerage", "taxable", "person-1", 150_000, costBasis=100_000, expectedReturn=0.05),
            acct("cash", "cash", "person-2", 20_000, expectedReturn=0.01),
        ],
        90_000,
        70_000,
        inflation=0.025,
        returnPreRetirement=0.05,
        returnPostRetirement=0.04,
        withdrawalStrategy="traditionalFirst",
        otherIncome=[
            {
                "id": "rental",
                "name": "Rental",
                "startYear": Y + 5,
                "endYear": Y + 14,
                "annualAmount": usd(12_000),
                "growth": {"mode": "inflation"},
            }
        ],
    ),
)

case(
    "tiered-match-escalation-cap-zero-return",
    "Auto-escalation 1%→7% walks the deferral rate below, at and above both match tiers; the $4,200 cap"
    " binds from 5%; flat 1%; 0% return so every balance is exact; retirement draws the 401(k).",
    household(
        [
            person(
                "person-1",
                Y - 40,
                48,
                50,
                employment={"baseSalary": usd(100_000), "raise": {"mode": "nominal", "rate": 0.02}},
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "traditionalPctOfSalary": 0.01,
                        "autoEscalation": {"stepPct": 0.01, "capPct": 0.07, "appliesTo": "traditional"},
                        "match": {"tiers": MATCH_3_2, "flatPctOfPay": 0.01, "annualMatchCap": usd(4_200)},
                    }
                ],
            )
        ],
        [acct("workplaceTraditional", "k401", "person-1", 0, expectedReturn=0)],
        60_000,
        30_000,
    ),
)

for _strategy, _desc in [
    ("taxableFirst", "cash → taxable → traditional (two accounts pro rata by cap) → Roth (basis first) → HSA"),
    ("traditionalFirst", "traditional (IRA and 401(k) pro rata by cap) → cash → taxable → Roth → HSA"),
    ("rothLast", "cash, taxable and traditional pro rata by cap → HSA → Roth"),
    ("proportional", "every account pro rata by its withdrawal cap"),
    ("bracketFill", "falls back to taxableFirst until the M4 tax model"),
]:
    case(
        f"strategy-{_strategy}",
        f"Retiree 70→76, 2% inflation, different returns per account, depletes: {_strategy} = {_desc}.",
        strategy_case(_strategy),
    )

case(
    "high-inflation-monthly-income",
    "Already retired at 65 with 8% inflation, monthly granularity (end of month): part-time and two other"
    " income streams (flat and rate growth) reduce withdrawals; a retirement cash schedule is unfunded"
    " (income below need); rothLast; expense ratio on the IRA.",
    household(
        [
            person(
                "person-1",
                Y - 65,
                65,
                90,
                employment={
                    "baseSalary": 0,
                    "raise": {"mode": "nominal", "rate": 0},
                    "partTime": {"startAge": 65, "endAge": 68, "annualIncome": usd(15_000)},
                },
            )
        ],
        [
            acct("traditionalIra", "ira", "person-1", 400_000, expectedReturn=0.07, expenseRatio=0.002),
            acct("rothIra", "roth", "person-1", 100_000, expectedReturn=0.07),
            acct(
                "cash",
                "cash",
                "person-1",
                5_000,
                expectedReturn=0.03,
                contribution={
                    "amount": {"kind": "dollars", "amount": usd(2_000), "frequency": "annual"},
                    "stopYear": Y + 2,
                },
            ),
        ],
        0,
        40_000,
        inflation=0.08,
        granularity="monthly",
        withdrawalStrategy="rothLast",
        otherIncome=[
            {"id": "annuity", "name": "Annuity", "startYear": Y, "endYear": Y + 19, "annualAmount": usd(10_000), "growth": {"mode": "flat"}},
            {
                "id": "consulting",
                "name": "Consulting",
                "startYear": Y + 4,
                "endYear": Y + 9,
                "annualAmount": usd(8_000),
                "growth": {"mode": "rate", "rate": 0.03},
            },
        ],
    ),
)

case(
    "negative-inflation-start-of-year-shock",
    "−2% inflation, conservative (start-of-year) withdrawals, a −30%/−10%/+15% market shock, negative cash"
    " return, taxable expense ratio and tax drag, zero raise, explicit-window % of salary schedule, and"
    " traditional/Roth IRA dollar schedules (requested amounts while IRA limits are unverified).",
    household(
        [
            person(
                "person-1",
                Y - 50,
                55,
                70,
                employment={"baseSalary": usd(90_000), "raise": {"mode": "nominal", "rate": 0}},
            )
        ],
        [
            acct(
                "taxableBrokerage",
                "taxable",
                "person-1",
                300_000,
                costBasis=300_000,
                expenseRatio=0.001,
                contribution={"amount": {"kind": "percentOfSalary", "pct": 0.1}, "startYear": Y + 1, "stopYear": Y + 3},
            ),
            acct("cash", "cash", "person-1", 50_000, expectedReturn=-0.01),
            acct(
                "traditionalIra",
                "ira",
                "person-1",
                50_000,
                contribution={"amount": {"kind": "dollars", "amount": usd(7_000), "frequency": "annual"}},
            ),
            acct(
                "rothIra",
                "roth",
                "person-1",
                20_000,
                contributionBasis=15_000,
                contribution={
                    "amount": {"kind": "dollars", "amount": usd(500), "frequency": "monthly"},
                    "growth": {"mode": "rate", "rate": 0.02},
                },
            ),
        ],
        60_000,
        50_000,
        inflation=-0.02,
        returnPreRetirement=0.04,
        returnPostRetirement=0.03,
        withdrawalTiming="startOfYear",
        taxableAccountTaxDrag=0.005,
        marketShock={"startYear": Y + 5, "returns": [-0.3, -0.1, 0.15]},
    ),
)

case(
    "monthly-start-of-month-fees-drag",
    "Retiree 68→80, monthly granularity with conservative (start-of-month) withdrawals, 1% IRA expense"
    " ratio, taxable expense ratio plus 1% tax drag, a zero-balance cash account, other income growing at"
    " a rate, proportional withdrawals and a minimum ending balance.",
    household(
        [person("person-1", Y - 68, 60, 80)],
        [
            acct("traditionalIra", "ira", "person-1", 250_000, expectedReturn=0.06, expenseRatio=0.01),
            acct("taxableBrokerage", "taxable", "person-1", 100_000, costBasis=60_000, expectedReturn=0.06, expenseRatio=0.003),
            acct("cash", "cash", "person-1", 0, expectedReturn=0.02),
        ],
        0,
        30_000,
        inflation=0.025,
        granularity="monthly",
        withdrawalTiming="startOfYear",
        withdrawalStrategy="proportional",
        taxableAccountTaxDrag=0.01,
        minimumEndingBalance=usd(100_000),
        otherIncome=[
            {"id": "royalty", "name": "Royalty", "startYear": Y, "annualAmount": usd(6_000), "growth": {"mode": "rate", "rate": 0.01}}
        ],
    ),
)

case(
    "retire-at-planning-age-zero-balance",
    "Age 30 retiring at planning age 35 (one retirement row), zero starting balances, 0% inflation,"
    " monthly flat cash schedule at 0% return (exact) and 10% of salary to a 4% taxable account.",
    household(
        [
            person(
                "person-1",
                Y - 30,
                35,
                35,
                employment={"baseSalary": usd(50_000), "raise": {"mode": "nominal", "rate": 0.03}},
            )
        ],
        [
            acct(
                "cash",
                "cash",
                "person-1",
                0,
                expectedReturn=0,
                contribution={"amount": {"kind": "dollars", "amount": usd(1_000), "frequency": "monthly"}},
            ),
            acct(
                "taxableBrokerage",
                "taxable",
                "person-1",
                0,
                costBasis=0,
                expectedReturn=0.04,
                contribution={"amount": {"kind": "percentOfSalary", "pct": 0.1}},
            ),
        ],
        30_000,
        20_000,
    ),
)

case(
    "already-retired-zero-balance",
    "Already retired with a zero balance: every year is a full shortfall; depletion in year 1.",
    household(
        [person("person-1", Y - 75, 70, 78)],
        [acct("cash", "cash", "person-1", 0, expectedReturn=0.03)],
        0,
        10_000,
        inflation=0.03,
    ),
)

case(
    "retirement-income-exceeds-need",
    "Retired at 66 (retirement age = current age) with part-time income above the need: scheduled taxable"
    " and Roth IRA contributions are scaled down to the income left after spending; no withdrawals.",
    household(
        [
            person(
                "person-1",
                Y - 66,
                66,
                72,
                employment={
                    "baseSalary": 0,
                    "raise": {"mode": "nominal", "rate": 0},
                    "partTime": {"startAge": 66, "endAge": 70, "annualIncome": usd(30_000)},
                },
            )
        ],
        [
            acct(
                "taxableBrokerage",
                "taxable",
                "person-1",
                50_000,
                costBasis=40_000,
                expectedReturn=0.05,
                contribution={
                    "amount": {"kind": "dollars", "amount": usd(15_000), "frequency": "annual"},
                    "stopYear": Y + 3,
                },
            ),
            acct(
                "rothIra",
                "roth",
                "person-1",
                30_000,
                contributionBasis=10_000,
                expectedReturn=0.05,
                contribution={
                    "amount": {"kind": "dollars", "amount": usd(5_000), "frequency": "annual"},
                    "growth": {"mode": "inflation"},
                    "stopYear": Y + 3,
                },
            ),
        ],
        0,
        20_000,
        inflation=0.03,
    ),
)



case(
    "part-time-and-owned-income-stop-at-death",
    "Couple both 70: B (planning age 75) has part-time pay to 95 and owns rental income; both stop after B's"
    " planning age (§1.4), so withdrawals rise from 2032. Mid-year timing, 2% inflation.",
    household(
        [
            person("person-1", Y - 70, 65, 90),
            person(
                "person-2",
                Y - 70,
                65,
                75,
                employment={
                    "baseSalary": 0,
                    "raise": {"mode": "nominal", "rate": 0},
                    "partTime": {"startAge": 70, "endAge": 95, "annualIncome": usd(30_000)},
                },
            ),
        ],
        [acct("cash", "cash", "person-1", 400_000, expectedReturn=0.03)],
        0,
        60_000,
        inflation=0.02,
        otherIncome=[
            {
                "id": "rent",
                "name": "Rent",
                "ownerId": "person-2",
                "startYear": Y,
                "annualAmount": usd(6_000),
                "growth": {"mode": "flat"},
            }
        ],
    ),
)

case(
    "salary-past-retirement-age",
    "Retirement age 62 but salary stops at 65: still working (accumulation) until 65 (§1.4), then"
    " withdrawals; 6% deferrals with a 100%-of-4% match, cliff vesting fully vested.",
    household(
        [
            person(
                "person-1",
                Y - 60,
                62,
                80,
                employment={"baseSalary": usd(90_000), "raise": {"mode": "nominal", "rate": 0.02}, "stopAge": 65},
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "traditionalPctOfSalary": 0.06,
                        "match": {
                            "tiers": [{"matchRate": 1, "bandPctOfPay": 0.04}],
                            "vesting": {"kind": "cliff", "years": 2},
                            "yearsOfServiceAtStart": 5,
                        },
                    }
                ],
            )
        ],
        [acct("workplaceTraditional", "k401", "person-1", 300_000, expectedReturn=0.05)],
        60_000,
        45_000,
        inflation=0.025,
    ),
)

case(
    "forfeiture-start-of-year-graded-seed",
    "Graded vesting with 2 years of service at start and an entered unvested balance (the not-yet-vested"
    " part, seeded as E0 = U0/(1 − v0), §4); separation after one year; start-of-year withdrawals.",
    household(
        [
            person(
                "person-1",
                Y - 64,
                65,
                75,
                employment={"baseSalary": usd(80_000), "raise": {"mode": "nominal", "rate": 0}},
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "traditionalPctOfSalary": 0.05,
                        "match": {
                            "tiers": [{"matchRate": 0.5, "bandPctOfPay": 0.06}],
                            "vesting": {"kind": "graded", "vestedByYear": [0.2, 0.4, 0.6, 0.8, 1]},
                            "yearsOfServiceAtStart": 2,
                        },
                    }
                ],
            )
        ],
        [
            acct("workplaceTraditional", "k401", "person-1", 120_000, unvestedEmployerBalance=usd(6_000), expectedReturn=0.04),
            acct("cash", "cash", "person-1", 20_000, expectedReturn=0.02),
        ],
        50_000,
        40_000,
        withdrawalTiming="startOfYear",
    ),
)


# --------------------------------------------------------------------------------------------
# M4 fixtures. "bundled" = every rule unverified (rule-free features only); "fixture" = the
# synthetic fixture rules (verified path). Verified-path fixtures use inflation 0 unless the name
# says otherwise (then §2 indexing with rounding metadata applies).
# --------------------------------------------------------------------------------------------


def ss_at(monthly: float, years: int, months: int = 0) -> dict:
    return {"source": {"kind": "atClaimAge", "monthlyAtClaim": usd(monthly)}, "claimAge": {"years": years, "months": months}}


def ss_pia(pia: float, years: int, months: int = 0) -> dict:
    return {"source": {"kind": "statement", "piaMonthly": usd(pia)}, "claimAge": {"years": years, "months": months}}


def annuity(pid: str, owner: str, start_age: int, amount: float, basis: str = "nominalAtStart", **extra: Any) -> dict:
    p = {
        "id": pid,
        "name": pid.title(),
        "ownerId": owner,
        "startAge": start_age,
        "annualAmount": usd(amount),
        "amountBasis": basis,
        "payout": {"kind": "annuity"},
    }
    p.update(extra)
    return p


def lump_sum(pid: str, owner: str, start_age: int, amount: float, dest: str, **extra: Any) -> dict:
    p = {
        "id": pid,
        "name": pid.title(),
        "ownerId": owner,
        "startAge": start_age,
        "annualAmount": 0,
        "amountBasis": "nominalAtStart",
        "payout": {"kind": "lumpSum", "amount": usd(amount), "destinationAccountId": dest},
    }
    p.update(extra)
    return p


def event(eid: str, year: int, direction: str, amount: float, basis: str = "nominal", **extra: Any) -> dict:
    e = {"id": eid, "name": eid.title(), "year": year, "direction": direction, "amount": usd(amount), "amountBasis": basis}
    e.update(extra)
    return e


def salary(amount: float, rate: float = 0.0, **extra: Any) -> dict:
    e = {"baseSalary": usd(amount), "raise": {"mode": "nominal", "rate": rate}}
    e.update(extra)
    return e


# ---- bundled rules: rule-free M4 features --------------------------------------------------

case(
    "spending-steps-glide-healthcare-survivor",
    "Couple retiring together in 2028 (62 and 60): spending steps by the first person's age (70, 80, and"
    " 85 after their death), −1% real glide from the first retirement year, a $12k pre-Medicare line"
    " while a living retiree is under 65, 25% survivor reduction from the first death; 2.5% inflation,"
    " start-of-year withdrawals (§5).",
    household(
        [
            person("person-1", Y - 60, 62, 80, employment=salary(100_000, 0.02)),
            person("person-2", Y - 58, 60, 90, employment=salary(70_000, 0.02)),
        ],
        [
            acct("cash", "cash", "person-1", 200_000, expectedReturn=0.03),
            acct("taxableBrokerage", "taxable", "person-2", 900_000, costBasis=500_000, expectedReturn=0.06),
        ],
        80_000,
        60_000,
        inflation=0.025,
        withdrawalTiming="startOfYear",
        spending={
            "steps": [
                {"fromAge": 70, "annualSpending": usd(50_000)},
                {"fromAge": 80, "annualSpending": usd(40_000)},
                {"fromAge": 85, "annualSpending": usd(35_000)},
            ],
            "retirementRealGlide": -0.01,
            "healthcareBeforeMedicare": usd(12_000),
            "survivorSpendingReduction": 0.25,
        },
    ),
)

case(
    "pensions-cola-survivor-lump-sums",
    "Retired couple (64, 62), 3% inflation: a today's-dollars annuity with inflation COLA and a 60% survivor"
    " share after its owner's death (2038), a nominal annuity with a 1.5% COLA, a flat nominal annuity, a"
    " lump sum rolled into the IRA and one deposited into the taxable account (basis; nominal even though"
    " the pension's amountBasis is today's dollars); rothLast (§7.6).",
    household(
        [person("person-1", Y - 64, 64, 75), person("person-2", Y - 62, 62, 88)],
        [
            acct("traditionalIra", "ira", "person-1", 300_000, expectedReturn=0.05),
            acct("taxableBrokerage", "taxable", "person-2", 200_000, costBasis=150_000, expectedReturn=0.05),
            acct("cash", "cash", "person-2", 30_000, expectedReturn=0.02),
            acct("rothIra", "roth", "person-2", 80_000, contributionBasis=60_000, expectedReturn=0.06),
        ],
        0,
        70_000,
        inflation=0.03,
        withdrawalStrategy="rothLast",
        pensions=[
            annuity("pension-a", "person-1", 65, 20_000, "todaysDollars", cola={"mode": "inflation"}, survivorFraction=0.6),
            annuity("pension-b", "person-2", 65, 15_000, cola={"mode": "rate", "rate": 0.015}),
            annuity("pension-c", "person-2", 63, 6_000, cola={"mode": "flat"}),
            lump_sum("lump-ira", "person-1", 66, 100_000, "ira"),
            # The pension's amountBasis describes annualAmount only; the lump sum is nominal
            # (PensionSchema: "Lump sum paid at the start age (nominal)").
            lump_sum("lump-taxable", "person-2", 64, 40_000, "taxable", amountBasis="todaysDollars"),
        ],
    ),
)

case(
    "one-time-events-accumulation-and-retirement",
    "Worker 55→60: a nominal outflow while working is withdrawn by the strategy (cash first); a today's-"
    "dollars inflow to an explicit cash destination; inflows without a destination go to the first taxable"
    " account (listed after cash) with basis; a today's-dollars outflow in retirement adds to the need;"
    " 2% inflation (§7.6).",
    household(
        [person("person-1", Y - 55, 60, 70, employment=salary(90_000, 0.03))],
        [
            acct("cash", "cash", "person-1", 40_000, expectedReturn=0.02),
            acct("traditionalIra", "ira", "person-1", 150_000, expectedReturn=0.05),
            acct("taxableBrokerage", "brokerage", "person-1", 60_000, costBasis=40_000, expectedReturn=0.05),
        ],
        60_000,
        50_000,
        inflation=0.02,
        oneTimeEvents=[
            event("roof", Y + 1, "outflow", 25_000),
            event("gift", Y + 2, "inflow", 30_000, "todaysDollars", destinationAccountId="cash"),
            event("bonus-payout", Y + 3, "inflow", 20_000),
            event("wedding", Y + 7, "outflow", 40_000, "todaysDollars"),
            event("land-sale", Y + 8, "inflow", 50_000, taxTreatment="capitalGain", gainFraction=0.5),
        ],
    ),
)

case(
    "one-time-inflow-surplus-account",
    "Retiree with a surplus account (cash) and a taxable account: an inflow without a destination goes to"
    " the surplus account, not the first taxable account; an outflow in nominal dollars (§7.6).",
    household(
        [person("person-1", Y - 68, 65, 74)],
        [
            acct("taxableBrokerage", "taxable", "person-1", 100_000, costBasis=80_000, expectedReturn=0.04),
            acct("cash", "savings", "person-1", 50_000, expectedReturn=0.01),
        ],
        0,
        30_000,
        inflation=0.02,
        surplus={"mode": "account", "accountId": "savings"},
        oneTimeEvents=[
            event("inheritance", Y + 2, "inflow", 75_000),
            event("car", Y + 4, "outflow", 35_000),
        ],
    ),
)

case(
    "one-time-inflow-first-cash",
    "Retiree with an IRA and a cash account but no taxable account: an inflow without a destination goes"
    " to the first cash account (§7.6); traditionalFirst.",
    household(
        [person("person-1", Y - 70, 65, 76)],
        [
            acct("traditionalIra", "ira", "person-1", 250_000, expectedReturn=0.05),
            acct("cash", "cash-a", "person-1", 10_000, expectedReturn=0.02),
            acct("cash", "cash-b", "person-1", 5_000, expectedReturn=0.0),
        ],
        0,
        35_000,
        inflation=0.02,
        withdrawalStrategy="traditionalFirst",
        oneTimeEvents=[event("refund", Y + 1, "inflow", 12_000, "todaysDollars")],
    ),
)

case(
    "one-time-inflow-spent-no-cash-or-taxable",
    "Retiree with only an IRA and an HSA: an inflow without a destination has nowhere to go and is spent"
    " (oneTimeInflowSpent); it is not spending income, so withdrawals are unchanged (§7.6).",
    household(
        [person("person-1", Y - 70, 65, 74)],
        [
            acct("traditionalIra", "ira", "person-1", 200_000, expectedReturn=0.04),
            acct("hsa", "hsa", "person-1", 20_000, expectedReturn=0.03),
        ],
        0,
        25_000,
        inflation=0.0,
        oneTimeEvents=[event("windfall", Y + 1, "inflow", 10_000)],
    ),
)

case(
    "social-security-at-claim-age-proration-cola-reduction",
    "Entered benefit at the claiming age (no rule values): born April, claim 67y6m → 3 months in the claim"
    " year; a set 1.5% COLA (not inflation) and a 21% benefit reduction from 2034 (§7.5); 2.5% inflation.",
    household(
        [person("person-1", Y - 66, 66, 80, birthMonth=4, socialSecurity=ss_at(2_100, 67, 6))],
        [
            acct("cash", "cash", "person-1", 300_000, expectedReturn=0.03),
            acct("traditionalIra", "ira", "person-1", 200_000, expectedReturn=0.05),
        ],
        0,
        45_000,
        inflation=0.025,
        socialSecurity={"cola": {"mode": "rate", "rate": 0.015}, "benefitReduction": {"fromYear": Y + 8, "reduction": 0.21}},
    ),
)

case(
    "social-security-couple-early-claim-survivor-excluded",
    "Couple with entered benefits: one claims at 62 while earning part-time pay (earnings-test warning, FRA"
    " unverified → 67); the other dies in 2034, their benefit stops and the survivor keeps only their own"
    " (survivor step excluded with the bundled rules); 20% survivor reduction; 2% inflation COLA.",
    household(
        [
            person(
                "person-1",
                Y - 62,
                62,
                85,
                socialSecurity=ss_at(1_600, 62),
                employment={
                    "baseSalary": 0,
                    "raise": {"mode": "nominal", "rate": 0},
                    "partTime": {"startAge": 62, "endAge": 66, "annualIncome": usd(20_000)},
                },
            ),
            person("person-2", Y - 65, 65, 72, socialSecurity=ss_at(2_400, 65)),
        ],
        [
            acct("traditionalIra", "ira", "person-2", 500_000, expectedReturn=0.05),
            acct("cash", "cash", "person-1", 40_000, expectedReturn=0.02),
        ],
        0,
        55_000,
        inflation=0.02,
    ),
)

case(
    "hsa-medical-and-excess-reinvested",
    "Retiree with a $50k pension: while it exceeds the need the excess is reinvested in the taxable account"
    " (with basis); from 72 a higher spending step makes HSA qualified medical withdrawals ($4k) come first,"
    " until the HSA runs out, then cash (§7.1 steps 4 and 6).",
    household(
        [person("person-1", Y - 68, 65, 78)],
        [
            acct("hsa", "hsa", "person-1", 10_000, expectedReturn=0.02),
            acct("taxableBrokerage", "taxable", "person-1", 0, costBasis=0, expectedReturn=0.04),
            acct("cash", "cash", "person-1", 100_000, expectedReturn=0.01),
        ],
        0,
        40_000,
        pensions=[annuity("pension", "person-1", 65, 50_000)],
        spending={"steps": [{"fromAge": 72, "annualSpending": usd(60_000)}], "hsaQualifiedMedicalExpenses": usd(4_000)},
    ),
)

# ---- fixture rules: the verified path --------------------------------------------------------

case(
    "verified-gross-up-taxableFirst",
    "Fixture rules, single 70: SS statement PIA $2,000 claimed at FRA; gross-up from cash, then taxable"
    " (gains stacked on ordinary income, Pub 915 including gains), then IRA; RMDs from 71 (2027); the"
    " senior deduction ends after 2029; 4% state tax (§6, §7.2).",
    household(
        [person("person-1", Y - 70, 65, 78, socialSecurity=ss_pia(2_000, 67))],
        [
            acct("cash", "cash", "person-1", 30_000, expectedReturn=0.02),
            acct("taxableBrokerage", "taxable", "person-1", 120_000, costBasis=60_000, expectedReturn=0.05),
            acct("traditionalIra", "ira", "person-1", 300_000, expectedReturn=0.05),
            acct("rothIra", "roth", "person-1", 100_000, contributionBasis=50_000, expectedReturn=0.06, firstContributionYear=2010),
        ],
        0,
        60_000,
        stateTaxRate=0.04,
    ),
    rules="fixture",
)

case(
    "verified-gross-up-traditionalFirst",
    "Fixture rules, single 75: RMD every year (period 27.5 at 75), a flat nominal pension, traditionalFirst"
    " gross-up from the IRA beyond the RMD, then cash; 5% state tax (§7.1 step 3, §7.2).",
    household(
        [person("person-1", Y - 75, 65, 82)],
        [
            acct("traditionalIra", "ira", "person-1", 500_000, expectedReturn=0.04),
            acct("cash", "cash", "person-1", 50_000, expectedReturn=0.02),
        ],
        0,
        50_000,
        stateTaxRate=0.05,
        withdrawalStrategy="traditionalFirst",
        pensions=[annuity("pension", "person-1", 65, 12_000)],
    ),
    rules="fixture",
)

case(
    "verified-gross-up-rothLast",
    "Fixture rules, single 66: cash, taxable and IRA pro rata, then HSA (non-medical, ordinary income), then"
    " a qualified Roth IRA (untaxed); HSA qualified medical first, limited by the HSA balance once it runs"
    " low; entered SS from 70 (§7.2, §7.3).",
    household(
        [person("person-1", Y - 66, 66, 75, socialSecurity=ss_at(1_500, 70))],
        [
            acct("cash", "cash", "person-1", 20_000, expectedReturn=0.01),
            acct("taxableBrokerage", "taxable", "person-1", 60_000, costBasis=30_000, expectedReturn=0.05),
            acct("traditionalIra", "ira", "person-1", 80_000, expectedReturn=0.05),
            acct("hsa", "hsa", "person-1", 30_000, expectedReturn=0.03),
            acct("rothIra", "roth", "person-1", 150_000, contributionBasis=40_000, expectedReturn=0.06, firstContributionYear=2015),
        ],
        0,
        45_000,
        withdrawalStrategy="rothLast",
        spending={"hsaQualifiedMedicalExpenses": usd(3_000)},
    ),
    rules="fixture",
)

case(
    "verified-gross-up-proportional",
    "Fixture rules, MFJ couple (68, 66) with the same last year (no death in the horizon): statement PIAs"
    " with an early own claim and the spousal excess (reduced 12 months early); every account pro rata"
    " (proportional); 3% state tax (§7.2, §7.5).",
    household(
        [
            person("person-1", Y - 68, 66, 76, socialSecurity=ss_pia(3_000, 67)),
            person("person-2", Y - 66, 66, 74, socialSecurity=ss_pia(1_000, 66)),
        ],
        [
            acct("cash", "cash", "person-1", 40_000, expectedReturn=0.02),
            acct("taxableBrokerage", "taxable", "person-2", 150_000, costBasis=100_000, expectedReturn=0.05),
            acct("traditionalIra", "ira", "person-1", 250_000, expectedReturn=0.05),
            acct("workplaceTraditional", "k401", "person-2", 150_000, expectedReturn=0.04),
            acct("rothIra", "roth", "person-2", 90_000, contributionBasis=30_000, expectedReturn=0.06, firstContributionYear=2000),
            acct("hsa", "hsa", "person-1", 25_000, expectedReturn=0.03),
        ],
        0,
        80_000,
        stateTaxRate=0.03,
        withdrawalStrategy="proportional",
    ),
    rules="fixture",
)

case(
    "verified-bracket-fill",
    "Fixture rules, single 72: bracket fill to the top of the 10% bracket (room = $10,000 + deductions −"
    " fixed ordinary income − taxable SS at the fixed income), then cash and taxable; SS PIA $1,500"
    " claimed at 70 (+21.6%); a flat pension (§7.3).",
    household(
        [person("person-1", Y - 72, 65, 78, socialSecurity=ss_pia(1_500, 70))],
        [
            acct("traditionalIra", "ira", "person-1", 600_000, expectedReturn=0.05),
            acct("cash", "cash", "person-1", 100_000, expectedReturn=0.02),
            acct("taxableBrokerage", "taxable", "person-1", 200_000, costBasis=150_000, expectedReturn=0.05),
        ],
        0,
        90_000,
        withdrawalStrategy="bracketFill",
        bracketFillTopRate=0.1,
        pensions=[annuity("pension", "person-1", 65, 10_000)],
    ),
    rules="fixture",
)

case(
    "verified-rmd-excess-reinvested-survivor-rollover",
    "Fixture rules, MFJ: SS and a pension exceed the need, so the RMD (after tax) is reinvested in the"
    " taxable account; the older IRA owner dies in 2029 (survivor SS step-up, survivor reduction), and the"
    " survivor's age (73) governs RMDs on the IRA; MFJ in 2029, single from 2030 (§7.1, §7.7).",
    household(
        [
            person("person-1", Y - 76, 65, 78, socialSecurity=ss_pia(2_500, 70)),
            person("person-2", Y - 70, 65, 85, socialSecurity=ss_pia(1_200, 67)),
        ],
        [
            acct("traditionalIra", "ira", "person-1", 800_000, expectedReturn=0.04),
            acct("taxableBrokerage", "taxable", "person-2", 0, costBasis=0, expectedReturn=0.05),
            acct("cash", "cash", "person-2", 20_000, expectedReturn=0.01),
        ],
        0,
        60_000,
        pensions=[annuity("pension", "person-2", 65, 30_000)],
    ),
    rules="fixture",
)

case(
    "verified-survivor-older-dies-first",
    "Fixture rules, MFJ: the older spouse (70, higher PIA, claimed early at 66) dies first in 2031; before,"
    " the younger gets the spousal excess; after, the survivor benefit (higher of own and the deceased's"
    " reduced benefit, 80% PIA floor), a 50% pension continuation, single filing from 2032 (§7.5, §7.7).",
    household(
        [
            person("person-1", Y - 70, 65, 74, socialSecurity=ss_pia(2_800, 66)),
            person("person-2", Y - 67, 65, 84, socialSecurity=ss_pia(900, 67)),
        ],
        [
            acct("traditionalIra", "ira", "person-1", 400_000, expectedReturn=0.04),
            acct("cash", "cash", "person-2", 60_000, expectedReturn=0.02),
            acct("taxableBrokerage", "taxable", "person-2", 200_000, costBasis=150_000, expectedReturn=0.05),
        ],
        0,
        70_000,
        stateTaxRate=0.02,
        pensions=[annuity("pension", "person-1", 65, 24_000, survivorFraction=0.5)],
    ),
    rules="fixture",
)

case(
    "verified-survivor-younger-dies-first",
    "Fixture rules, MFJ: the younger spouse (67, higher PIA) dies first in 2032; the older survivor (claimed"
    " at 70) steps up to the deceased's benefit; the deceased's future pension (start 70, 2% COLA) continues"
    " in full; RMDs on both IRAs follow the survivor's age; traditionalFirst (§7.5-§7.7).",
    household(
        [
            person("person-1", Y - 70, 65, 84, socialSecurity=ss_pia(1_500, 70)),
            person("person-2", Y - 67, 65, 72, socialSecurity=ss_pia(2_400, 67)),
        ],
        [
            acct("traditionalIra", "ira-1", "person-1", 300_000, expectedReturn=0.04),
            acct("traditionalIra", "ira-2", "person-2", 350_000, expectedReturn=0.05),
            acct("cash", "cash", "person-1", 30_000, expectedReturn=0.02),
        ],
        0,
        75_000,
        withdrawalStrategy="traditionalFirst",
        pensions=[annuity("pension", "person-2", 70, 18_000, cola={"mode": "rate", "rate": 0.02}, survivorFraction=1)],
    ),
    rules="fixture",
)

case(
    "verified-survivor-equal-planning-ages",
    "Fixture rules, MFJ couple born the same year with equal planning ages: nobody dies inside the horizon,"
    " so the spousal excess (claimed 36 months early: own 0.82, spousal 0.784) continues to the end and the"
    " filing status stays MFJ; RMDs from 71 (§7.5, §7.7).",
    household(
        [
            person("person-1", Y - 68, 65, 85, socialSecurity=ss_pia(3_000, 67)),
            person("person-2", Y - 68, 65, 85, socialSecurity=ss_pia(1_000, 64)),
        ],
        [
            acct("traditionalIra", "ira", "person-1", 700_000, expectedReturn=0.04),
            acct("taxableBrokerage", "taxable", "person-2", 300_000, costBasis=200_000, expectedReturn=0.05),
        ],
        0,
        85_000,
        stateTaxRate=0.03,
    ),
    rules="fixture",
)

case(
    "verified-accumulation-net-pay-surplus-infeasible",
    "Fixture rules, MFJ: a worker above the SS wage base (FICA per person) while the retired spouse draws a"
    " reduced statement benefit (taxed in net pay); surplus routed to the taxable account; a −60% raise"
    " override makes 2028 infeasible; then retirement in 2030 with gross-up; 5% state tax (§3.8, §6).",
    household(
        [
            person(
                "person-1",
                Y - 50,
                54,
                70,
                socialSecurity=ss_pia(2_500, 67),
                employment={
                    "baseSalary": usd(180_000),
                    "raise": {"mode": "nominal", "rate": 0.03},
                    "bonus": {"kind": "percentOfSalary", "pct": 0.1},
                    "raiseOverrides": [{"year": Y + 2, "rate": -0.6}, {"year": Y + 3, "rate": 1.0}],
                },
            ),
            person("person-2", Y - 63, 62, 83, socialSecurity=ss_pia(1_800, 62)),
        ],
        [
            acct("taxableBrokerage", "taxable", "person-1", 50_000, costBasis=40_000, expectedReturn=0.05),
            acct(
                "cash",
                "cash",
                "person-2",
                20_000,
                expectedReturn=0.02,
                contribution={"amount": {"kind": "dollars", "amount": usd(500), "frequency": "monthly"}, "stopYear": Y + 3},
            ),
            acct("traditionalIra", "ira", "person-1", 100_000, expectedReturn=0.05),
        ],
        90_000,
        80_000,
        stateTaxRate=0.05,
        surplus={"mode": "account", "accountId": "taxable"},
    ),
    rules="fixture",
)

case(
    "verified-workplace-catch-up-hsa-ira-limits",
    "Fixture rules, single 54: a 25% 401(k) election is capped at $20,000 + $7,000 catch-up (deferralCapped),"
    " the 3% match is unaffected; family HSA at the maximum ($8,000, +$1,000 catch-up from 55); a $9,000"
    " traditional IRA schedule capped at $8,000; surplus routed to taxable; retirement at 58 with HSA"
    " medical withdrawals (§3.4-§3.6, §3.8).",
    household(
        [
            person(
                "person-1",
                Y - 54,
                58,
                62,
                employment=salary(120_000, 0, priorYearFicaWages=usd(118_000)),
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "traditionalPctOfSalary": 0.25,
                        "match": {"tiers": [{"matchRate": 1, "bandPctOfPay": 0.03}]},
                    }
                ],
            )
        ],
        [
            acct("workplaceTraditional", "k401", "person-1", 150_000, expectedReturn=0.05),
            acct(
                "hsa",
                "hsa",
                "person-1",
                10_000,
                coverage="family",
                hdhpAttested=True,
                expectedReturn=0.03,
                contribution={"amount": {"kind": "maxAllowed"}},
            ),
            acct(
                "traditionalIra",
                "ira",
                "person-1",
                30_000,
                expectedReturn=0.05,
                contribution={"amount": {"kind": "dollars", "amount": usd(9_000), "frequency": "annual"}},
            ),
            acct("taxableBrokerage", "taxable", "person-1", 20_000, costBasis=20_000, expectedReturn=0.04),
            acct("cash", "cash", "person-1", 30_000, expectedReturn=0.01),
        ],
        50_000,
        40_000,
        surplus={"mode": "account", "accountId": "taxable"},
        spending={"hsaQualifiedMedicalExpenses": usd(2_000)},
    ),
    rules="fixture",
)

case(
    "verified-roth-ira-phase-out",
    "Fixture rules, single 40: MAGI = salary − 401(k) − HSA = $113,000 inside the $100k–$115k phase-out:"
    " $7,000 × 2,000/15,000 rounded up to $10 = $940, then limited by the IRA room left after a $2,000"
    " traditional IRA; 2027 MAGI above $115k → ineligible; a 20% pay cut in 2028 brings it back to full"
    " and makes that year infeasible (surplus < 0) (§3.7, §3.8).",
    household(
        [
            person(
                "person-1",
                Y - 40,
                45,
                47,
                employment=salary(130_000, 0.02, raiseOverrides=[{"year": Y + 2, "rate": -0.2}]),
                workplacePlans=[
                    {
                        "id": "plan-1",
                        "planType": "401k",
                        "traditionalAccountId": "k401",
                        "traditionalPctOfSalary": 0.1,
                        "match": {"tiers": []},
                    }
                ],
            )
        ],
        [
            acct("workplaceTraditional", "k401", "person-1", 60_000, expectedReturn=0.05),
            acct(
                "hsa",
                "hsa",
                "person-1",
                5_000,
                coverage="selfOnly",
                hdhpAttested=True,
                expectedReturn=0.03,
                contribution={"amount": {"kind": "dollars", "amount": usd(4_000), "frequency": "annual"}},
            ),
            acct(
                "traditionalIra",
                "ira",
                "person-1",
                20_000,
                expectedReturn=0.05,
                contribution={"amount": {"kind": "dollars", "amount": usd(2_000), "frequency": "annual"}},
            ),
            acct(
                "rothIra",
                "roth",
                "person-1",
                15_000,
                contributionBasis=12_000,
                expectedReturn=0.06,
                contribution={"amount": {"kind": "maxAllowed"}},
            ),
            acct("cash", "cash", "person-1", 400_000, expectedReturn=0.02),
        ],
        60_000,
        50_000,
    ),
    rules="fixture",
)

case(
    "verified-roth-hsa-early-flags",
    "Fixture rules, retired at 50 with proportional withdrawals: Roth IRA earnings before the fixture's 59y4m are flagged"
    " (rothEarningsWithdrawnEarly) and HSA non-medical use before 65 is flagged (hsaNonMedicalPre65); income"
    " stays below the deduction, so no tax either way (§7.4).",
    household(
        [person("person-1", Y - 50, 50, 54)],
        [
            acct("rothIra", "roth", "person-1", 100_000, contributionBasis=10_000, expectedReturn=0.0, firstContributionYear=2015),
            acct("hsa", "hsa", "person-1", 50_000, expectedReturn=0.0),
            acct("cash", "cash", "person-1", 60_000, expectedReturn=0.01),
        ],
        0,
        30_000,
        withdrawalStrategy="proportional",
    ),
    rules="fixture",
)

case(
    "verified-one-time-events-lump-sum-taxes",
    "Fixture rules, single 66: a lump sum into taxable (50% taxable fraction → ordinary income) and one rolled"
    " into the IRA (untaxed); a capital-gain inflow (40% gain → LTCG, basis assumption) to the first taxable"
    " account; an ordinary-income inflow to cash; a retirement outflow grossed up; entered SS prorated (born"
    " July, 6 months); 3% state tax (§7.6).",
    household(
        [person("person-1", Y - 66, 65, 72, birthMonth=7, socialSecurity=ss_at(2_000, 67))],
        [
            acct("traditionalIra", "ira", "person-1", 200_000, expectedReturn=0.04),
            acct("cash", "cash", "person-1", 50_000, expectedReturn=0.02),
            acct("taxableBrokerage", "taxable", "person-1", 100_000, costBasis=100_000, expectedReturn=0.05),
        ],
        0,
        40_000,
        stateTaxRate=0.03,
        pensions=[
            lump_sum("lump-taxable", "person-1", 67, 80_000, "taxable", taxableFraction=0.5),
            lump_sum("lump-ira", "person-1", 68, 50_000, "ira"),
        ],
        oneTimeEvents=[
            event("home-sale", Y + 3, "inflow", 100_000, taxTreatment="capitalGain", gainFraction=0.4),
            event("severance", Y + 4, "inflow", 20_000, taxTreatment="ordinaryIncome", destinationAccountId="cash"),
            event("new-roof", Y + 5, "outflow", 30_000),
        ],
    ),
    rules="fixture",
)

case(
    "verified-indexed-rules-inflation",
    "Fixture rules with 3% inflation: tax-year values after 2026 are indexed per §2 (brackets, deductions,"
    " LTCG breakpoints and wage base to the cent; statutory-fixed SS thresholds and senior deduction"
    " carried; the senior deduction absent after 2029); RMD from 71 (2026); traditionalFirst.",
    household(
        [person("person-1", Y - 71, 65, 76, socialSecurity=ss_at(2_500, 70))],
        [
            acct("traditionalIra", "ira", "person-1", 400_000, expectedReturn=0.05),
            acct("cash", "cash", "person-1", 40_000, expectedReturn=0.02),
        ],
        0,
        50_000,
        inflation=0.03,
        withdrawalStrategy="traditionalFirst",
    ),
    rules="fixture",
)

# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------

EXPECTED_KEYS = ("rows", "summary", "warnings", "excludedFeatures")


def fixture_for(c: dict) -> dict:
    expected = project(copy.deepcopy(c["household"]), c["currentYear"], c["rules"])
    return {**c, "expected": {k: expected[k] for k in EXPECTED_KEYS}}


def slug(name: str) -> str:
    return name + ".json"


def write() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    keep = set()
    for c in CASES:
        path = FIXTURES / slug(c["name"])
        path.write_text(json.dumps(fixture_for(c), indent=2) + "\n", encoding="utf-8")
        keep.add(path.name)
    for stale in FIXTURES.glob("*.json"):
        if stale.name not in keep:
            stale.unlink()
    print(f"wrote {len(CASES)} fixtures to {FIXTURES}")
    # The repository formats JSON with Prettier (pnpm format:check); format the fixtures if available.
    root = HERE.parents[2]
    try:
        subprocess.run(
            ["pnpm", "exec", "prettier", "--write", str(FIXTURES)], cwd=root, check=True, capture_output=True
        )
    except (OSError, subprocess.CalledProcessError):
        print("note: prettier not available; run `pnpm format` before committing", file=sys.stderr)


def diff(path: str, a: Any, b: Any, out: list[str]) -> None:
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            diff(f"{path}.{k}", a.get(k), b.get(k), out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: length {len(a)} != {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(f"{path}[{i}]", x, y, out)
    elif isinstance(a, float) or isinstance(b, float):
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float))) or abs(a - b) > 1e-12 * max(1, abs(a)):
            out.append(f"{path}: {a!r} != {b!r}")
    elif a != b:
        out.append(f"{path}: {a!r} != {b!r}")


def check() -> int:
    problems: list[str] = []
    names = {slug(c["name"]) for c in CASES}
    on_disk = {p.name for p in FIXTURES.glob("*.json")}
    for missing in sorted(names - on_disk):
        problems.append(f"{missing}: missing (run --write)")
    for extra in sorted(on_disk - names):
        problems.append(f"{extra}: not produced by ref.py")
    for c in CASES:
        path = FIXTURES / slug(c["name"])
        if not path.exists():
            continue
        committed = json.loads(path.read_text(encoding="utf-8"))
        out: list[str] = []
        # The committed household must be the case definition, and its expectation must recompute.
        diff("household", c["household"], committed["household"], out)
        diff("rules", c["rules"], committed.get("rules"), out)
        try:
            recomputed = project(copy.deepcopy(committed["household"]), committed["currentYear"], committed.get("rules", ""))
            diff("expected", {k: recomputed[k] for k in EXPECTED_KEYS}, committed["expected"], out)
        except Unsupported as e:
            out.append(f"uses a path the docs leave ambiguous: {e}")
        problems.extend(f"{path.name}: {line}" for line in out[:20])
    if problems:
        print("\n".join(problems))
        print(f"FAIL: {len(problems)} difference(s)")
        return 1
    print(f"OK: {len(CASES)} fixtures match the reference")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--write", action="store_true", help="regenerate fixtures")
    g.add_argument("--check", action="store_true", help="recompute and compare with committed fixtures")
    args = ap.parse_args()
    if args.write:
        write()
        return 0
    return check()


if __name__ == "__main__":
    sys.exit(main())
