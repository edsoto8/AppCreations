# User Guide

> Draft. Completed in M8; sections are added as features ship.

Retirement Navigator is a local-first retirement planning tool. Results are model-dependent educational
estimates, not guarantees, tax advice, or investment recommendations. Taxes are simplified estimates.

## Getting started
1. Install Node 22.22+ and pnpm 10, then run `pnpm install && pnpm dev` in `RetirementNavigator/`.
2. Open the address Vite prints (http://localhost:5173).
3. The first time, the **Welcome** screen offers two ways to start:
   - **Start blank:** answer a few questions (name, birth year, retirement age, salary, spending,
     optional spouse).
   - **Use a sample:** early career, mid-career couple, near retirement, or high earner.

   Either way you then see **Income & Savings**; choose **Finish setup** when done.

## Dashboard
- The **Dashboard** (the home page) shows ten cards. Each card states its dollars (today's or future,
  set with **Today's / Future dollars**), whether taxes are included, and the year it refers to. The
  ⓘ button explains the formula.
- **Readiness** is a heuristic, not a probability:
  - *On track*: the baseline and the pessimistic run both last through the planning age;
  - *Borderline*: only the baseline lasts;
  - *At risk*: the baseline runs out.
- The **Forecast** chart shows the portfolio each year. The optimistic and pessimistic lines are
  fixed return offsets (±2 points by default), not confidence intervals. Lines mark retirement, the
  first death (couples) and the year the money runs out. **Annual flows** shows contributions,
  growth and withdrawals.
- **Where the money is** stacks balances by account type and by tax treatment.
- **Forecast details** lists every year.
- Every chart has a **Show … data table** button with the same figures.
- **While rule values are unverified**, the forecast leaves those steps out and says so in a banner
  and on each affected card:
  - contributions are as you elected them, **before plan limits**;
  - retirement income is **before taxes**;
  - take-home pay is not shown.
- Retirement spending is funded first by income (Social Security, pensions, other income), then by
  withdrawals in the order you choose. Taxes, required minimum distributions and some Social
  Security amounts need verified rules; until then they are left out and labeled (see Retirement
  Income).
- **Forecast settings** (on the Profile page):
  - withdrawal timing (mid-year, or start of year as a conservative choice);
  - annual or monthly calculation;
  - the withdrawal order;
  - where leftover pay goes while working;
  - the optimistic and pessimistic offsets;
  - a minimum ending balance in today's dollars.

## Retirement Income
- **Social Security:** for each person, choose how to enter it.
  - **Benefit at your claiming age** (recommended for now): the monthly amount your SSA statement
    lists for the age you plan to claim, in today's dollars. It needs no rule values, so it is
    included in the forecast today.
  - **Benefit at full retirement age**, or the **illustrative estimate** from earnings (not an
    official SSA calculation): these need SSA rule values (full retirement age, early and delayed
    factors) that are not verified yet. They show as "Not available yet" and are left out of the
    forecast.
  - Spousal and survivor benefits also need verified SSA rules. Until then each person keeps their
    own benefit, and the forecast says so.
  - Benefits rise with the COLA assumption (inflation by default). An optional benefit-reduction
    scenario is an assumption, not a prediction.
  - Claiming before full retirement age while still working shows a warning: the earnings test is
    not modeled.
- **Pensions:**
  - start age, amount (today's dollars or nominal at start), COLA and taxable share;
  - annuity or lump sum (paid into an account);
  - the share that continues to a surviving spouse.
- **Other income** and **one-time events:**
  - an inheritance or home sale is deposited into an account;
  - a large expense is withdrawn from savings in its year.
- **Spending plan:**
  - spending steps by age;
  - a yearly real change (glide);
  - healthcare before Medicare, which you enter yourself (early-retirement plans should include
    it);
  - the reduction after the first death.
- **Gross to net:** each retirement year lists income by source, taxes and net income.
  - While tax rules are unverified, income is shown **before taxes**.
  - Required minimum distributions are left out and labeled until their rules are verified.

## Profiles
- The header switcher changes the active profile.
- **Profiles** (under Tools) creates, renames, duplicates and deletes profiles, and adds sample
  copies.
- Changes save automatically on this device.

## Profile
- Ages are calendar year minus birth year.
- Retirement starts January 1 of the year you reach your retirement age; there is no salary that
  year.
- **Planning age** is how long the plan must last.
- **Add a spouse** switches the filing status to married filing jointly. Other filing statuses are
  not supported.
- State tax is one flat effective rate that you enter.
- Spending is in today's dollars. Retirement spending is an after-tax need.
- Assumptions (inflation, returns, rules anchor year) are labeled and editable.

## Income & Savings
- Enter salary, an optional bonus (percent of salary or a fixed amount) and raises (nominal, or
  inflation plus a real raise). The page shows the implied real raise.
- Add year-specific raises (for example a promotion) and an optional part-time phase.
- For each workplace plan:
  - Set traditional and Roth percentages of salary and bonus.
  - Optionally turn on automatic increases.
  - Build the employer match from tiers ("100% of the first 3%, then 50% of the next 2%"), and set
    any flat employer contribution, an annual cap and vesting.
- The **match readout** shows the contribution that captures the full match, what you capture
  now, and what is left unclaimed. While plan limits are unverified it is labeled "before plan
  limits"; once they are verified it also shows the match the forecast counts after limits.
- The **10-year preview** and the **take-home pay check** update as you type. Use **Today's / Future
  dollars** to switch the basis.

## Accounts, Roth IRA, HSA
- **Accounts** lists every account with its tax treatment, balance, return, fees and contributions.
  Workplace-plan contributions are set on Income & Savings.
- An account can't be deleted while a plan or a setting still points to it.
- **Roth IRA** shows the estimated MAGI (you can override it) and this year's allowed contribution.
  The figures are the same ones the forecast uses. The estimate subtracts deferrals and HSA
  contributions after plan limits, so it shows **Unverified rule** until those limits are verified;
  you can still enter your own MAGI.
- **HSA** needs high-deductible health plan coverage before contributions are allowed. Each person
  has one HSA limit, shared by all of that person's HSAs.

## Rules & Sources and "Unverified rule"
- Every contribution limit, tax bracket and Social Security parameter comes from an official
  source (irs.gov, ssa.gov, federalregister.gov), with its retrieval date.
- A value that hasn't been confirmed at source is **unverified**. The app never fills it in.
  Features that need it are shown as **Not available yet** with an **Unverified rule** label.
- The Rules & Sources page lists every value, its status, source and candidate values (shown for
  reference only, never used in calculations).

## Your data
Everything you enter is stored in your browser's IndexedDB on this device, **unencrypted**. Nothing
is sent over the network. See **Data & Privacy** in the app.

## Theme
Use the sun / moon / screen buttons in the header to choose light, dark or your system setting.
