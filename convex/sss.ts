/**
 * SSS (Social Security System) Philippines - Contribution calculator
 *
 * Uses the official Schedule of SSS Contributions (Range of Compensation →
 * Monthly Salary Credit → EE/ER amounts). Input: employee's monthly basic salary
 * (excluding allowances). Used for:
 * - Payslip: employee deduction = getSSSContribution(basicPay).employeeShare (split per cutoff if bimonthly)
 * - Accounting: employer contribution = getSSSContribution(basicPay).employerShare when creating records
 */

export type SSSContribution = {
  /** Employee share (monthly) - amount to deduct from payslip */
  employeeShare: number;
  /** Employer share (monthly) - use for accounting employer contribution records */
  employerShare: number;
  /** Total monthly contribution (employee + employer) for accounting */
  total: number;
  /** Monthly salary credit for this bracket */
  monthlySalaryCredit: number;
};

type SSSBracket = {
  min: number;
  max: number | null;
  employeeShare: number;
  employerShare: number;
  total: number;
  monthlySalaryCredit: number;
};

// Official SSS schedule: Range of Compensation → MSC → EE total, ER total (incl. EC)
// Covers from Below 4,250 through 29,750-Over (ref: official contribution table)
const SSS_TABLE: SSSBracket[] = [
  { min: 0, max: 4249.99, employeeShare: 180, employerShare: 410, total: 590, monthlySalaryCredit: 4000 },
  { min: 4250, max: 4749.99, employeeShare: 202.5, employerShare: 452.5, total: 655, monthlySalaryCredit: 4500 },
  { min: 4750, max: 5249.99, employeeShare: 225, employerShare: 495, total: 720, monthlySalaryCredit: 5000 },
  { min: 5250, max: 5749.99, employeeShare: 247.5, employerShare: 537.5, total: 785, monthlySalaryCredit: 5500 },
  { min: 5750, max: 6249.99, employeeShare: 270, employerShare: 580, total: 850, monthlySalaryCredit: 6000 },
  { min: 6250, max: 6749.99, employeeShare: 292.5, employerShare: 622.5, total: 915, monthlySalaryCredit: 6500 },
  { min: 6750, max: 7249.99, employeeShare: 315, employerShare: 665, total: 980, monthlySalaryCredit: 7000 },
  { min: 7250, max: 7749.99, employeeShare: 337.5, employerShare: 707.5, total: 1045, monthlySalaryCredit: 7500 },
  { min: 7750, max: 8249.99, employeeShare: 360, employerShare: 750, total: 1110, monthlySalaryCredit: 8000 },
  { min: 8250, max: 8749.99, employeeShare: 382.5, employerShare: 792.5, total: 1175, monthlySalaryCredit: 8500 },
  { min: 8750, max: 9249.99, employeeShare: 405, employerShare: 835, total: 1240, monthlySalaryCredit: 9000 },
  { min: 9250, max: 9749.99, employeeShare: 427.5, employerShare: 877.5, total: 1305, monthlySalaryCredit: 9500 },
  { min: 9750, max: 10249.99, employeeShare: 450, employerShare: 920, total: 1370, monthlySalaryCredit: 10000 },
  { min: 10250, max: 10749.99, employeeShare: 472.5, employerShare: 962.5, total: 1435, monthlySalaryCredit: 10500 },
  { min: 10750, max: 11249.99, employeeShare: 495, employerShare: 1005, total: 1500, monthlySalaryCredit: 11000 },
  { min: 11250, max: 11749.99, employeeShare: 517.5, employerShare: 1047.5, total: 1565, monthlySalaryCredit: 11500 },
  { min: 11750, max: 12249.99, employeeShare: 540, employerShare: 1090, total: 1630, monthlySalaryCredit: 12000 },
  { min: 12250, max: 12749.99, employeeShare: 562.5, employerShare: 1132.5, total: 1695, monthlySalaryCredit: 12500 },
  { min: 12750, max: 13249.99, employeeShare: 585, employerShare: 1175, total: 1760, monthlySalaryCredit: 13000 },
  { min: 13250, max: 13749.99, employeeShare: 607.5, employerShare: 1217.5, total: 1825, monthlySalaryCredit: 13500 },
  { min: 13750, max: 14249.99, employeeShare: 630, employerShare: 1260, total: 1890, monthlySalaryCredit: 14000 },
  { min: 14250, max: 14749.99, employeeShare: 652.5, employerShare: 1302.5, total: 1955, monthlySalaryCredit: 14500 },
  { min: 14750, max: 15249.99, employeeShare: 675, employerShare: 1365, total: 2040, monthlySalaryCredit: 15000 },
  { min: 15250, max: 15749.99, employeeShare: 697.5, employerShare: 1407.5, total: 2105, monthlySalaryCredit: 15500 },
  { min: 15750, max: 16249.99, employeeShare: 720, employerShare: 1450, total: 2170, monthlySalaryCredit: 16000 },
  { min: 16250, max: 16749.99, employeeShare: 742.5, employerShare: 1492.5, total: 2235, monthlySalaryCredit: 16500 },
  { min: 16750, max: 17249.99, employeeShare: 765, employerShare: 1535, total: 2300, monthlySalaryCredit: 17000 },
  { min: 17250, max: 17749.99, employeeShare: 787.5, employerShare: 1577.5, total: 2365, monthlySalaryCredit: 17500 },
  { min: 17750, max: 18249.99, employeeShare: 810, employerShare: 1620, total: 2430, monthlySalaryCredit: 18000 },
  { min: 18250, max: 18749.99, employeeShare: 832.5, employerShare: 1662.5, total: 2495, monthlySalaryCredit: 18500 },
  { min: 18750, max: 19249.99, employeeShare: 855, employerShare: 1705, total: 2560, monthlySalaryCredit: 19000 },
  { min: 19250, max: 19749.99, employeeShare: 877.5, employerShare: 1747.5, total: 2625, monthlySalaryCredit: 19500 },
  { min: 19750, max: 20249.99, employeeShare: 900, employerShare: 1790, total: 2690, monthlySalaryCredit: 20000 },
  { min: 20250, max: 20749.99, employeeShare: 922.5, employerShare: 1977.5, total: 2900, monthlySalaryCredit: 20500 },
  { min: 20750, max: 21249.99, employeeShare: 945, employerShare: 2020, total: 2965, monthlySalaryCredit: 21000 },
  { min: 21250, max: 21749.99, employeeShare: 967.5, employerShare: 2062.5, total: 3030, monthlySalaryCredit: 21500 },
  { min: 21750, max: 22249.99, employeeShare: 990, employerShare: 2105, total: 3095, monthlySalaryCredit: 22000 },
  { min: 22250, max: 22749.99, employeeShare: 1012.5, employerShare: 2147.5, total: 3160, monthlySalaryCredit: 22500 },
  { min: 22750, max: 23249.99, employeeShare: 1035, employerShare: 2190, total: 3225, monthlySalaryCredit: 23000 },
  { min: 23250, max: 23749.99, employeeShare: 1057.5, employerShare: 2232.5, total: 3290, monthlySalaryCredit: 23500 },
  { min: 23750, max: 24249.99, employeeShare: 1080, employerShare: 2275, total: 3355, monthlySalaryCredit: 24000 },
  { min: 24250, max: 24749.99, employeeShare: 1102.5, employerShare: 2317.5, total: 3420, monthlySalaryCredit: 24500 },
  { min: 24750, max: 25249.99, employeeShare: 1125, employerShare: 2360, total: 3485, monthlySalaryCredit: 25000 },
  { min: 25250, max: 25749.99, employeeShare: 1147.5, employerShare: 2402.5, total: 3550, monthlySalaryCredit: 25500 },
  { min: 25750, max: 26249.99, employeeShare: 1170, employerShare: 2445, total: 3615, monthlySalaryCredit: 26000 },
  { min: 26250, max: 26749.99, employeeShare: 1192.5, employerShare: 2487.5, total: 3680, monthlySalaryCredit: 26500 },
  { min: 26750, max: 27249.99, employeeShare: 1215, employerShare: 2530, total: 3745, monthlySalaryCredit: 27000 },
  { min: 27250, max: 27749.99, employeeShare: 1237.5, employerShare: 2572.5, total: 3810, monthlySalaryCredit: 27500 },
  { min: 27750, max: 28249.99, employeeShare: 1260, employerShare: 2615, total: 3875, monthlySalaryCredit: 28000 },
  { min: 28250, max: 28749.99, employeeShare: 1282.5, employerShare: 2657.5, total: 3940, monthlySalaryCredit: 28500 },
  { min: 28750, max: 29249.99, employeeShare: 1305, employerShare: 2700, total: 4005, monthlySalaryCredit: 29000 },
  { min: 29250, max: 29749.99, employeeShare: 1327.5, employerShare: 2742.5, total: 4070, monthlySalaryCredit: 29500 },
  { min: 29750, max: null, employeeShare: 1350, employerShare: 2880, total: 4230, monthlySalaryCredit: 30000 },
];

/**
 * Get SSS contribution for a given monthly basic pay (salary only, excluding allowances).
 * Finds the bracket by range of compensation and returns EE/ER amounts.
 * For semi-monthly payroll use employeeShare/2 per cutoff; employer share split the same way.
 */
export function getSSSContribution(monthlyBasicPay: number): SSSContribution {
  const pay = Math.max(0, monthlyBasicPay);
  for (const bracket of SSS_TABLE) {
    if (bracket.max === null) {
      if (pay >= bracket.min) {
        return {
          employeeShare: bracket.employeeShare,
          employerShare: bracket.employerShare,
          total: bracket.total,
          monthlySalaryCredit: bracket.monthlySalaryCredit,
        };
      }
    } else {
      if (pay >= bracket.min && pay <= bracket.max) {
        return {
          employeeShare: bracket.employeeShare,
          employerShare: bracket.employerShare,
          total: bracket.total,
          monthlySalaryCredit: bracket.monthlySalaryCredit,
        };
      }
    }
  }
  const last = SSS_TABLE[SSS_TABLE.length - 1];
  return {
    employeeShare: last.employeeShare,
    employerShare: last.employerShare,
    total: last.total,
    monthlySalaryCredit: last.monthlySalaryCredit,
  };
}
