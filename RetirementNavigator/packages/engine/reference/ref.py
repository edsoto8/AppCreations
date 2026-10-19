#!/usr/bin/env python3
"""Independent Python reference for the Retirement Navigator deterministic projection (M3).

Written from docs/financial-model.md only (never from the engine source). Python 3.13, stdlib only.

Scope (households that need no rule values, or that run "before limits" with the bundled rules,
where every regulatory value is unverified, docs §1.7):
  - one or two people (single / MFJ); age, retirement, longevity and phase rules (§1.4);
  - employment: base salary, nominal or inflation-plus-real raises, year overrides, bonus
    (none / percent / fixed with salary, own-rate or flat growth), part-time phase (§3.1);
  - workplace plans BEFORE LIMITS (§1.7, §3.2-3.5): traditional/Roth % of salary and of bonus,
    bonus eligibility toggles, auto-escalation, tiered match + flat + annual match cap, vesting
    (immediate / cliff / graded) with forfeiture at separation (§4);
  - scheduled contributions (§3.6): taxable brokerage and cash (dollars annual/monthly growing
    flat / with inflation / at a rate, percent of salary, start/stop years), plus traditional and
    Roth IRA and HSA "dollars"/"percent" schedules, which contribute the requested amount while
    the IRA/HSA limits are unverified (§1.7). "maxAllowed" contributes nothing (§1.7, §3.6). An
    HSA without HDHP attestation contributes nothing (§3.6). "other" accounts are not modeled.
  - growth (§1.5, §1.6, §4): expected-return precedence, deterministic offset, market shock,
    -99% floor, expense ratio, taxable tax drag; annual mid-year / start-of-year timing; monthly
    end-of-month / start-of-month factors;
  - retirement-phase spending and simple withdrawals (§4.1, §7.3 order): taxableFirst,
    traditionalFirst, rothLast, proportional; bracketFill falls back to taxableFirst; part-time
    and other income reduce withdrawals; retirement-phase scheduled contributions only from
    income left after spending; depletion; taxable basis pro rata to the cap; Roth IRA basis first;
  - deflator / real values, phases, markers and summary (§1.1, §1.4, §4.1, §8).

Rounding (§1.3): all math in float64 dollars; each output is converted to cents once, rounding half
to even (a float that is within a few ulps of an exact half is treated as the tie, mirroring
src/money.test.ts); growthNet is the reconciling item.

Assumptions where the docs are silent are marked "ASSUMPTION" below and listed in the QA report.

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
    }


def plan_of(plan: dict) -> dict:
    m = plan["match"]
    return {
        "id": plan["id"],
        "traditionalAccountId": plan["traditionalAccountId"],
        "rothAccountId": plan.get("rothAccountId"),
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
# §4.1: bracketFill needs the tax model; it falls back to taxableFirst in M3.
STRATEGY_ORDER["bracketFill"] = STRATEGY_ORDER["taxableFirst"]


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


# --------------------------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------------------------


def project(h: dict, current_year: int, return_offset: float = 0.0) -> dict:
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

    people = h["people"]
    for p in people:
        p.setdefault("planningAge", 100)
    y1 = current_year
    last = max(p["birthYear"] + p["planningAge"] for p in people)
    n_years = last - y1 + 1

    emps = [employment_of(p) for p in people]
    plans = [[plan_of(w) for w in p.get("workplacePlans", [])] for p in people]
    accounts = h.get("accounts", [])
    acct_by_id = {x["id"]: x for x in accounts}
    person_idx = {p["id"]: k for k, p in enumerate(people)}

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

    # Per-plan vesting state: separated flag and projection years worked.
    plan_state = [[{"separated": False, "worked": 0} for _ in pl] for pl in plans]
    base_prev = [None] * len(people)
    bonus_prev = [None] * len(people)

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

    rows = []
    price = 1.0
    retirement_year = None
    depletion_year = None
    first_death = min(p["birthYear"] + p["planningAge"] + 1 for p in people)
    first_death_year = first_death if first_death <= last else None
    warnings: set[str] = set()

    for t in range(1, n_years + 1):
        year = y1 + t - 1
        if t >= 2:
            price *= 1.0 + inflation

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
                # ASSUMPTION: part-time income needs the person alive.
                if ptp is not None and alive and ptp["startAge"] <= age < ptp["endAge"]:
                    pt = d(ptp["annualIncome"]) * price
            prow.append(
                # §1.4: retired = at or past the retirement age and drawing no salary.
                {"age": age, "alive": alive, "retired": retired and not working, "working": working, "base": base, "bonus": bonus, "pt": pt}
            )

        phase = "retirement" if all(r["retired"] for r in prow if r["alive"]) else "accumulation"
        if phase == "retirement" and retirement_year is None:
            retirement_year = year

        # ---- returns and growth factors (§1.5, §1.6, §4)
        g_net, g_gross = {}, {}
        for x in accounts:
            r = account_return(x, phase, year)
            rho = (1.0 + r) * (1.0 - x.get("expenseRatio", 0.0)) - 1.0
            if x["type"] == "taxableBrokerage":
                rho -= drag
            g_net[x["id"]] = factors(rho, timing, granularity)
            g_gross[x["id"]] = factors(r, timing, granularity)

        # ---- workplace contributions before limits (§1.7, §3.2-3.5)
        contrib = {x["id"]: 0.0 for x in accounts}
        employer = {x["id"]: 0.0 for x in accounts}
        forfeit = {x["id"]: 0.0 for x in accounts}
        for k, p in enumerate(people):
            e = emps[k]
            pr = prow[k]
            pr.update({"eDef": 0.0, "eMatch": 0.0, "dT": 0.0, "dR": 0.0, "match": 0.0, "flatC": 0.0})
            if pr["working"]:
                # §3.2 eligible pay is per person (plan-independent), before the unverified L^comp.
                pr["eDef"] = pr["base"] + (pr["bonus"] if e["bonusCountsForDeferrals"] else 0.0)
                pr["eMatch"] = pr["base"] + (pr["bonus"] if e["bonusCountsForMatch"] else 0.0)
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
                e_match = whole_cents(e_match)
                deferral = whole_cents(d_t_f + d_r_f)
                delta = deferral / e_match if e_match > 0 else 0.0
                m = 0.0
                lo = 0.0
                for tier in pl["tiers"]:
                    hi = lo + tier["bandPctOfPay"]
                    m += tier["matchRate"] * max(0.0, min(delta, hi) - lo) * e_match
                    lo = hi
                if pl["cap"] is not None:
                    m = min(m, d(pl["cap"]))
                m = whole_cents(m)
                flat = whole_cents(pl["flat"] * e_match)
                contrib[pl["traditionalAccountId"]] += d_t
                if d_r > 0:
                    contrib[pl["rothAccountId"]] += d_r
                contrib[dest] += m + flat
                employer[dest] += m + flat
                pr["dT"] += d_t
                pr["dR"] += d_r
                pr["match"] += m
                pr["flatC"] += flat
                st["worked"] += 1

        # ---- scheduled contributions (§3.6, §1.7)
        sched = {}
        for x in accounts:
            s = x.get("contribution")
            if s is None or x["type"] in ("workplaceTraditional", "workplaceRoth"):
                continue
            k = person_idx[x["ownerId"]]
            start = s.get("startYear") if s.get("startYear") is not None else y1
            stop = s.get("stopYear") if s.get("stopYear") is not None else last_working_year(k)
            if not (start <= year <= stop):
                continue
            amt = s["amount"]
            if x["type"] == "hsa" and not x["hdhpAttested"]:
                continue
            if amt["kind"] == "dollars":
                v = d(amt["amount"]) * (12 if amt["frequency"] == "monthly" else 1)
                gm = s.get("growth", {"mode": "flat"})
                if gm["mode"] == "inflation":
                    v *= price
                elif gm["mode"] == "rate":
                    v *= (1.0 + gm["rate"]) ** (t - 1)
            elif amt["kind"] == "percentOfSalary":
                v = amt["pct"] * prow[k]["base"]
            else:
                v = 0.0  # maxAllowed: unknown limit (IRA/HSA) or no limit (taxable/cash)
            v = whole_cents(v)  # §1.3: contribution amounts are whole cents
            if v > 0:
                sched[x["id"]] = v

        # ---- income and spending
        other = 0.0
        for inc in h.get("otherIncome", []):
            end_y = inc.get("endYear")
            owner_k = person_idx.get(inc.get("ownerId")) if inc.get("ownerId") is not None else None
            if owner_k is not None and year > people[owner_k]["birthYear"] + people[owner_k]["planningAge"]:
                continue  # §1.4: owned income stops after the owner's planning age
            if inc["startYear"] <= year and (end_y is None or year <= end_y):
                v = d(inc["annualAmount"])
                gm = inc.get("growth", {"mode": "inflation"})
                if gm["mode"] == "inflation":
                    v *= price
                elif gm["mode"] == "rate":
                    v *= (1.0 + gm["rate"]) ** (t - 1)
                other += v
        earned = sum(r["base"] + r["bonus"] + r["pt"] for r in prow)
        part_time = sum(r["pt"] for r in prow)

        need_w = 0.0
        if phase == "retirement":
            need = d(sp["retirementAnnualSpending"]) * price
            income = part_time + other  # §4.1 step 2 (no salary in the retirement phase)
            req = sum(sched.values())
            avail = max(0.0, income - need)
            if req > avail + 1e-9:
                scale = avail / req if req > 0 else 0.0
                # §1.3: scaled amounts round down to whole cents so they never exceed the income left over.
                sched = {k2: math.floor(v * scale * 100 + 1e-9) / 100 for k2, v in sched.items()}
                warnings.add("retirementContributionsReduced")
            need_w = max(0.0, need + sum(sched.values()) - income)
        else:
            need = d(sp["currentAnnualSpending"]) * price  # ASSUMPTION: accumulation need is funded from pay
        for k2, v in sched.items():
            contrib[k2] += v

        # ---- forfeitures at the start of the year, then caps (§4, §1.5)
        start_bal = dict(bal)
        s_after = {k2: bal[k2] - forfeit[k2] for k2 in bal}
        caps = {
            x["id"]: withdrawal_cap(s_after[x["id"]], contrib[x["id"]], g_net[x["id"]], timing, granularity)
            for x in accounts
        }
        wd = {x["id"]: 0.0 for x in accounts}
        remaining = need_w
        for group in STRATEGY_ORDER[strategy]:
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
        shortfall = max(0.0, remaining)
        if strategy == "bracketFill":
            warnings.add("withdrawalStrategyFallback")

        # ---- account update
        out_accounts = []
        fee_total = 0.0
        for x in accounts:
            i = x["id"]
            g_s, g_c, g_w = g_net[i]
            e_net = max(0.0, g_s * s_after[i] + g_c * contrib[i] - g_w * wd[i])
            gs2, gc2, gw2 = g_gross[i]
            e_gross = gs2 * s_after[i] + gc2 * contrib[i] - gw2 * wd[i]
            fee_total += e_gross - e_net
            if x["type"] == "taxableBrokerage":
                c0 = basis[i] + contrib[i]
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
                    "forfeited": cents(forfeit[i]),
                    "end": c_end,
                    "basisEnd": cents(basis.get(i, 0.0)),
                }
            )

        funded = need_w - shortfall
        depleted = shortfall > 0.005
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
        spending_need = need if phase == "retirement" else need
        spending_funded = (need - shortfall) if phase == "retirement" else need
        gross_income = (part_time + other + funded) if phase == "retirement" else (earned + other)
        rows.append(
            {
                "year": year,
                "phase": phase,
                "deflator": price,
                "people": [
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
                        "employerMatch": cents(r["match"]),
                        "employerFlat": cents(r["flatC"]),
                    }
                    for p, r in zip(people, prow)
                ],
                "accounts": out_accounts,
                # §1.3: household flow totals are sums of the per-account cents (so they reconcile
                # with the account rows); spending figures round the float need once.
                "flows": {
                    "contributions": sum(ao["contributions"] for ao in out_accounts),
                    "employerContributions": sum(ao["employerContributions"] for ao in out_accounts),
                    "feeDrag": sum(ao["feeDrag"] for ao in out_accounts),
                    "withdrawals": sum(ao["withdrawals"] - ao["forfeited"] for ao in out_accounts),
                    "forfeited": sum(ao["forfeited"] for ao in out_accounts),
                    "spendingNeed": cents(spending_need),
                    "spendingFunded": cents(spending_funded),
                    "shortfall": cents(shortfall),
                },
                "totals": {
                    "portfolioStart": sum(ao["start"] for ao in out_accounts),
                    "portfolioEnd": sum(ao["end"] for ao in out_accounts),
                    "byTaxTreatment": by_tt,
                },
                "real": {
                    "portfolioEnd": cents(port_end_float / price),
                    "spendingNeed": cents(spending_need / price),
                    "grossIncome": cents(gross_income / price),
                },
                "grossIncome": cents(gross_income),
                "depleted": depleted,
                "markers": markers,
            }
        )

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
        "infeasibleYears": [],
        "deterministicSuccess": depletion_year is None and ending_real_float >= min_end - 0.005,
    }
    return {"rows": rows, "summary": summary, "warnings": sorted(warnings)}


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
    if other_income:
        h["otherIncome"] = other_income
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


def case(name: str, description: str, h: dict) -> None:
    CASES.append({"name": name, "description": description, "currentYear": Y, "household": h})


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


# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------


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


def fixture_for(c: dict) -> dict:
    expected = project(copy.deepcopy(c["household"]), c["currentYear"])
    return {**c, "expected": {"rows": expected["rows"], "summary": expected["summary"], "warnings": expected["warnings"]}}


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
        recomputed = project(copy.deepcopy(committed["household"]), committed["currentYear"])
        diff("expected", {k: recomputed[k] for k in ("rows", "summary", "warnings")}, committed["expected"], out)
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
