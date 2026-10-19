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
  now, and what is left unclaimed.
- The **10-year preview** and the **take-home pay check** update as you type. Use **Today's / Future
  dollars** to switch the basis.

## Accounts, Roth IRA, HSA
- **Accounts** lists every account with its tax treatment, balance, return, fees and contributions.
  Workplace-plan contributions are set on Income & Savings.
- An account can't be deleted while a plan or a setting still points to it.
- **Roth IRA** shows the estimated MAGI (you can override it) and this year's allowed contribution.
- **HSA** needs high-deductible health plan coverage before contributions are allowed.

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
