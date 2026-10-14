#!/usr/bin/env python3
"""Independent reference calculations for LoanPilot's engine tests.

Written separately from the C# engine, using exact rational arithmetic (fractions.Fraction) and
rounding half away from zero to cents at each posting. Run it to regenerate the expected values
quoted in backend/tests/LoanPilot.Core.Tests/ReferenceScheduleTests.cs:

    python3 tools/reference_amortization.py
"""
from datetime import date, timedelta
from fractions import Fraction as F
import calendar

CENT = F(1, 100)


def round_cents(x: F) -> F:
    """Round half away from zero to the cent."""
    sign = -1 if x < 0 else 1
    scaled = abs(x) * 100
    whole = scaled.numerator // scaled.denominator
    if scaled - whole >= F(1, 2):
        whole += 1
    return F(sign * whole, 100)


def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def standard_payment(principal, apr_percent, n, periods_per_year=12):
    principal = F(principal)
    if apr_percent == 0:
        return round_cents(principal / n)
    i = F(apr_percent) / 100 / periods_per_year
    g = (1 + i) ** n
    return round_cents(principal * i * g / (g - 1))


def daily_interest(balance, apr_percent, start, end, basis):
    rate = F(apr_percent) / 100
    if basis == "actual365":
        return balance * rate * (end - start).days / 365
    total = F(0)
    cur = start
    while cur < end:
        nxt = min(date(cur.year + 1, 1, 1), end)
        days_in_year = 366 if calendar.isleap(cur.year) else 365
        total += balance * rate * (nxt - cur).days / days_in_year
        cur = nxt
    return total


def schedule(principal, apr_percent, n, first_payment, start=None, payment=None, method="monthly",
             basis="actual365", extra=0, lumps=()):
    """Returns rows (date, interest, principal, total, balance). lumps: [(date, amount)] credited
    with the first payment on/after their date (monthly) or posted on their date (daily)."""
    balance = F(principal)
    pay = F(payment) if payment is not None else standard_payment(principal, apr_percent, n)
    extra = F(extra)
    rows = []
    last = start
    pending = F(0)
    lumps = sorted(lumps)
    k = 0
    while balance > 0:
        due = add_months(first_payment, k)
        lump_extra = F(0)
        while lumps and lumps[0][0] <= due:
            ld, amt = lumps.pop(0)
            amt = F(amt)
            if method == "daily" and ld < due:
                pending += daily_interest(balance, apr_percent, last, ld, basis)
                last = ld
                assert amt <= balance
                balance -= amt
                rows.append((ld, F(0), amt, amt, balance))
            else:
                lump_extra += amt
        if method == "daily":
            interest = round_cents(pending + daily_interest(balance, apr_percent, last, due, basis))
            pending = F(0)
            last = due
        else:
            interest = round_cents(balance * F(apr_percent) / 100 / 12)
        owed = balance + interest
        scheduled = pay
        ext = extra + lump_extra
        if scheduled >= owed:
            scheduled, ext = owed, F(0)
        elif scheduled + ext >= owed:
            ext = owed - scheduled
        elif k + 1 == n and owed - scheduled - ext <= pay:
            scheduled = owed - ext  # final payment adjustment
        total = scheduled + ext
        principal_paid = total - interest
        balance -= principal_paid
        rows.append((due, interest, principal_paid, total, balance))
        k += 1
    return pay, rows


def summarize(label, pay, rows):
    payments = [r for r in rows if r[1] != 0 or r[3] != r[2] or True]
    total_interest = sum(r[1] for r in rows)
    total_paid = sum(r[3] for r in rows)
    print(f"{label}: payment={float(pay):.2f} rows={len(rows)} totalInterest={float(total_interest):.2f} "
          f"totalPaid={float(total_paid):.2f} final={float(rows[-1][3]):.2f} payoff={rows[-1][0]} "
          f"first(interest={float(rows[0][1]):.2f}, principal={float(rows[0][2]):.2f})")


if __name__ == "__main__":
    summarize("A 25000@6% 60m", *schedule(25000, 6, 60, date(2024, 2, 1)))
    summarize("B 20000@0% 48m", *schedule(20000, 0, 48, date(2024, 2, 1)))
    summarize("C 32500@7.24% 72m +100", *schedule(32500, F("7.24"), 72, date(2025, 1, 15), extra=100))
    summarize("C0 32500@7.24% 72m", *schedule(32500, F("7.24"), 72, date(2025, 1, 15)))
    summarize("D daily365 15000@5.9% 36m", *schedule(15000, F("5.9"), 36, date(2024, 2, 15), start=date(2024, 1, 15),
                                                     method="daily", basis="actual365"))
    summarize("E dailyAA 15000@5.9% 36m", *schedule(15000, F("5.9"), 36, date(2024, 2, 15), start=date(2024, 1, 15),
                                                    method="daily", basis="actualActual"))
    summarize("F 25000@6% 60m lump 2000 on 2025-01-10",
              *schedule(25000, 6, 60, date(2024, 2, 1), lumps=[(date(2025, 1, 10), 2000)]))
    summarize("G daily365 15000@5.9% 36m lump 1500 on 2024-06-01",
              *schedule(15000, F("5.9"), 36, date(2024, 2, 15), start=date(2024, 1, 15), method="daily",
                        basis="actual365", lumps=[(date(2024, 6, 1), 1500)]))
    summarize("H 18000@4.5% 60m month-end first 2024-01-31", *schedule(18000, F("4.5"), 60, date(2024, 1, 31)))
    pay, rows = schedule(18000, F("4.5"), 60, date(2024, 1, 31))
    print("H dates:", [str(r[0]) for r in rows[:4]])
