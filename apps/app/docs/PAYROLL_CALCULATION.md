# Payroll Calculation Guide

This document describes how payroll is calculated, including all rate types and sample scenarios. All dates and times use **Manila (UTC+8)** for consistency.

---

## 1. Base pay and daily rate

- **Monthly salary**: Basic pay per cutoff = `basicSalary × (12 / payFrequency divisor)`. For bimonthly, half of monthly.
- **Daily rate**: `(basicSalary + allowance if included) × (12 / workingDaysPerYear)`. Default working days per year = 261.
- **Hourly rate**: Daily rate ÷ 8. Used for OT, night diff, and late/undertime deductions.

---

## 2. Overtime (OT) rates

| Context | Default rate | Meaning |
|--------|--------------|---------|
| Regular day OT | 125% | Hourly × 1.25 per OT hour |
| Rest day OT | 169% | Hourly × 1.69 per hour worked on rest day |
| Regular (legal) holiday OT | 200% | Hourly × 2.0 per OT hour |
| Special non-working holiday OT | 169% | Hourly × 1.69 per OT hour |

OT hours are **user-entered** per attendance record (not auto-derived from clock-out). The system applies the appropriate rate based on whether the day is a rest day or holiday.

---

## 3. Night differential (10 PM–6 AM)

Night diff applies to worked time in **10:00 PM–6:00 AM** that also falls **inside the employee’s scheduled shift** for that day. **Same-day example:** schedule **2 PM–11 PM** → 1 hour night (10–11 PM). Schedule **1 PM–10 PM** → **0** night unless **overtime** is recorded: only minutes that are **both** after 10 PM **and** inside the **OT window** (last *N* hours before clock-out) get night diff—e.g. **1h OT** to **11 PM** → one hour of **night-on-OT** (137.5% stack); **1h OT** to **midnight** → only **11 PM–12 AM** counts (not 10–11 PM). **Overnight** (e.g. 6 PM–3 AM): post–scheduled-out morning minutes follow the same OT rule. **Regular holiday overnight:** night diff uses the **holiday night rate** (e.g. 220% stack on 200%), including **12 AM–scheduled end** next day; lunch (e.g. **11 PM–12 AM**) is excluded so night = **10–11 PM** + **12 AM–3 AM**.

### 3.1 Base night diff (regular, non-OT)

- **Rate**: 10% (configurable: **Night Differential %** in org settings).
- **Formula**: `night diff pay = eligible hours in 10pm–6am × hourly rate × (nightDiffRate − 1)` (premium on top of base pay already earned).
- **Example**: Schedule 2 PM–11 PM, worked until 11:15 PM, OT = 0 → only 10–11 PM counts (1 h). Friday schedule to 10 PM → no night diff for 10–10:30 PM.

### 3.2 Night diff on top of OT (137.5%)

- **Rate**: 137.5% of hourly (configurable: **Night diff on OT %**).
- **When**: OT hours that fall in 10 PM–6 AM on a **regular (non-holiday) day**.
- **Meaning**: Instead of 125% for those OT hours, the employee gets 137.5% for the night OT portion only.
- **Example**: Schedule until 8 PM, worked until 11 PM; 3 h OT. 8–10 PM = 2 h at 125%, 10–11 PM = 1 h at 137.5%. Premium added in night-diff block for the 1 h = (1.375 − 1.25) × hourly × 1.

### 3.3 Night diff on regular holiday (220%)

- **Rate**: 220% of hourly (configurable: **Night diff on regular holiday %**).
- **When**: Night hours on a **regular (legal) holiday**.
- **Overnight shift from a holiday**: If the shift **starts** on a regular holiday and crosses midnight (overnight schedule), night hours **after midnight until scheduled end** still use the regular-holiday night stack (not “next calendar day only”).

### 3.4 Night diff on special non-working holiday (143%)

- **Rate**: 143% of hourly (configurable: **Night diff on special holiday %**).
- **When**: Night hours on a **special non-working holiday**, including the post-midnight portion of an overnight shift that **started** on that special holiday.

### 3.5 Regular holiday + OT + night (286%)

- **Rate**: 286% of hourly (configurable: **Regular holiday + OT + night %**).
- **When**: OT hours in 10 PM–6 AM while on regular holiday (including continuation after midnight on the same overnight shift).

### 3.6 Special holiday + OT + night (185.9%)

- **Rate**: 185.9% of hourly (configurable: **Special holiday + OT + night %**).
- **When**: OT hours in 10 PM–6 AM on a special holiday (including overnight continuation).

---

## 4. Late and undertime deductions

- **Late**: Minutes late × (hourly rate basic+allowance). Categorized by day type:
  - Regular day: 100%.
  - Regular holiday: 200% (employee rate).
  - Special holiday: 130% (employee rate).
- **Undertime**: Hours undertime × (hourly rate basic+allowance). Undertime = leaving earlier than scheduled (or shortfall vs required minutes when lunch is considered).

---

## 5. Holiday pay

- **Regular holiday**: (daily rate or basic daily) × (regularHolidayRate − 1), e.g. 200% → 1× extra day pay.
- **Special holiday**: (daily rate or basic daily) × (specialHolidayRate − 1), e.g. 130% → 0.3× extra.
- Applied per **day** (not per hour). Late on that day is deducted separately.

---

## 6. Sample scenarios

### Scenario A: Regular day, OT until 11 PM

- Schedule: 9 AM–6 PM. Actual: 9 AM–11 PM. OT = 5 h.
- 6–10 PM: 4 h OT at 125%.
- 10–11 PM: 1 h OT in night window → night diff on OT at 137.5%.
- Night diff block adds: 1 × hourly × (1.375 − 1.25) = 0.125 × hourly.

### Scenario B: Regular holiday, shift 6 PM–2 AM

- Holiday = today (e.g. Dec 25). Schedule 6 PM–2 AM; no OT.
- 6 PM–12 AM: 6 h on holiday. Night part 10–12 PM = 2 h at 220%.
- 12 AM–2 AM: 2 h on next day (not holiday) = 2 h at 10% night diff.
- Night diff pay = 2 × hourly × (2.20 − 1) + 2 × hourly × 0.10.

### Scenario C: Special holiday + OT, night on same day only

- Special holiday today. Schedule 6 PM–12 AM, 2 h OT (10 PM–12 AM).
- 10–12 AM: 2 h OT, night, on holiday → 2 h at 185.9% (special holiday + OT + night).
- If shift were 6 PM–3 AM and OT 3 h: 10 PM–12 AM = 2 h at 185.9%; 12 AM–1 AM = 1 h on next day = 10% night diff only.

---

## 7. Configuration

- **Organization (defaults)**: Settings → Payroll → Night Differential % and the five advanced night-diff rates (night diff on OT, regular holiday, special holiday, reg holiday+OT+night, spec holiday+OT+night).
- **Per employee**: Employee → Edit → Compensation. Same five night-diff rates can be overridden per employee; otherwise org defaults apply.

Rates are stored as decimals (e.g. 1.375 for 137.5%). The UI shows percentages (137.5).
