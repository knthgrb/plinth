/**
 * SSS (Social Security System) Philippines - Contribution calculator
 * Based on: SCHEDULE OF SSS CONTRIBUTIONS FOR BUSINESS EMPLOYERS AND EMPLOYEES
 * Effective January 2025. Uses monthly basic pay (excluding allowances).
 */

export type SSSContribution = {
  /** Employee share (monthly) - amount to deduct from payslip */
  employeeShare: number;
  /** Employer share (monthly) - employer's contribution */
  employerShare: number;
  /** Total monthly contribution (employee + employer) for accounting */
  total: number;
  /** Monthly salary credit for this bracket */
  monthlySalaryCredit: number;
};

/** SSS bracket: range of monthly compensation (min inclusive, max inclusive or null for "above") */
type SSSBracket = {
  min: number;
  max: number | null; // null = "above"
  employeeShare: number;
  employerShare: number;
  total: number;
  monthlySalaryCredit: number;
};

// Schedule of SSS Contributions - Effective January 2025 (monthly amounts in PHP)
const SSS_TABLE_2025: SSSBracket[] = [
  { min: 0, max: 5249.99, employeeShare: 250, employerShare: 510, total: 760, monthlySalaryCredit: 5000 },
  { min: 5250, max: 5749.99, employeeShare: 275, employerShare: 560, total: 835, monthlySalaryCredit: 5500 },
  { min: 5750, max: 6249.99, employeeShare: 300, employerShare: 610, total: 910, monthlySalaryCredit: 6000 },
  { min: 6250, max: 6749.99, employeeShare: 325, employerShare: 660, total: 985, monthlySalaryCredit: 6500 },
  { min: 6750, max: 7249.99, employeeShare: 350, employerShare: 710, total: 1060, monthlySalaryCredit: 7000 },
  { min: 7250, max: 7749.99, employeeShare: 375, employerShare: 760, total: 1135, monthlySalaryCredit: 7500 },
  { min: 7750, max: 8249.99, employeeShare: 400, employerShare: 810, total: 1210, monthlySalaryCredit: 8000 },
  { min: 8250, max: 8749.99, employeeShare: 425, employerShare: 860, total: 1285, monthlySalaryCredit: 8500 },
  { min: 8750, max: 9249.99, employeeShare: 450, employerShare: 910, total: 1360, monthlySalaryCredit: 9000 },
  { min: 9250, max: 9749.99, employeeShare: 475, employerShare: 960, total: 1435, monthlySalaryCredit: 9500 },
  { min: 9750, max: 10249.99, employeeShare: 500, employerShare: 1010, total: 1510, monthlySalaryCredit: 10000 },
  { min: 10250, max: 10749.99, employeeShare: 525, employerShare: 1060, total: 1585, monthlySalaryCredit: 10500 },
  { min: 10750, max: 11249.99, employeeShare: 550, employerShare: 1110, total: 1660, monthlySalaryCredit: 11000 },
  { min: 11250, max: 11749.99, employeeShare: 575, employerShare: 1160, total: 1735, monthlySalaryCredit: 11500 },
  { min: 11750, max: 12249.99, employeeShare: 600, employerShare: 1210, total: 1810, monthlySalaryCredit: 12000 },
  { min: 12250, max: 12749.99, employeeShare: 625, employerShare: 1260, total: 1885, monthlySalaryCredit: 12500 },
  { min: 12750, max: 13249.99, employeeShare: 650, employerShare: 1310, total: 1960, monthlySalaryCredit: 13000 },
  { min: 13250, max: 13749.99, employeeShare: 675, employerShare: 1360, total: 2035, monthlySalaryCredit: 13500 },
  { min: 13750, max: 14249.99, employeeShare: 700, employerShare: 1410, total: 2110, monthlySalaryCredit: 14000 },
  { min: 14250, max: 14749.99, employeeShare: 725, employerShare: 1460, total: 2185, monthlySalaryCredit: 14500 },
  { min: 14750, max: 15249.99, employeeShare: 750, employerShare: 1530, total: 2280, monthlySalaryCredit: 15000 },
  { min: 15250, max: 15749.99, employeeShare: 775, employerShare: 1580, total: 2355, monthlySalaryCredit: 15500 },
  { min: 15750, max: 16249.99, employeeShare: 800, employerShare: 1630, total: 2430, monthlySalaryCredit: 16000 },
  { min: 16250, max: 16749.99, employeeShare: 825, employerShare: 1680, total: 2505, monthlySalaryCredit: 16500 },
  { min: 16750, max: 17249.99, employeeShare: 850, employerShare: 1730, total: 2580, monthlySalaryCredit: 17000 },
  { min: 17250, max: 17749.99, employeeShare: 875, employerShare: 1780, total: 2655, monthlySalaryCredit: 17500 },
  { min: 17750, max: 18249.99, employeeShare: 900, employerShare: 1830, total: 2730, monthlySalaryCredit: 18000 },
  { min: 18250, max: 18749.99, employeeShare: 925, employerShare: 1880, total: 2805, monthlySalaryCredit: 18500 },
  { min: 18750, max: 19249.99, employeeShare: 950, employerShare: 1930, total: 2880, monthlySalaryCredit: 19000 },
  { min: 19250, max: 19749.99, employeeShare: 975, employerShare: 1980, total: 2955, monthlySalaryCredit: 19500 },
  { min: 19750, max: 20249.99, employeeShare: 1000, employerShare: 2030, total: 3030, monthlySalaryCredit: 20000 },
  { min: 20250, max: 20749.99, employeeShare: 1025, employerShare: 2080, total: 3105, monthlySalaryCredit: 20500 },
  { min: 20750, max: 21249.99, employeeShare: 1050, employerShare: 2130, total: 3180, monthlySalaryCredit: 21000 },
  { min: 21250, max: 21749.99, employeeShare: 1075, employerShare: 2180, total: 3255, monthlySalaryCredit: 21500 },
  { min: 21750, max: 22249.99, employeeShare: 1100, employerShare: 2230, total: 3330, monthlySalaryCredit: 22000 },
  { min: 22250, max: 22749.99, employeeShare: 1125, employerShare: 2280, total: 3405, monthlySalaryCredit: 22500 },
  { min: 22750, max: 23249.99, employeeShare: 1150, employerShare: 2330, total: 3480, monthlySalaryCredit: 23000 },
  { min: 23250, max: 23749.99, employeeShare: 1175, employerShare: 2380, total: 3555, monthlySalaryCredit: 23500 },
  { min: 23750, max: 24249.99, employeeShare: 1200, employerShare: 2430, total: 3630, monthlySalaryCredit: 24000 },
  { min: 24250, max: 24749.99, employeeShare: 1225, employerShare: 2480, total: 3705, monthlySalaryCredit: 24500 },
  { min: 24750, max: 25249.99, employeeShare: 1250, employerShare: 2530, total: 3780, monthlySalaryCredit: 25000 },
  { min: 25250, max: 25749.99, employeeShare: 1275, employerShare: 2580, total: 3855, monthlySalaryCredit: 25500 },
  { min: 25750, max: 26249.99, employeeShare: 1300, employerShare: 2630, total: 3930, monthlySalaryCredit: 26000 },
  { min: 26250, max: 26749.99, employeeShare: 1325, employerShare: 2680, total: 4005, monthlySalaryCredit: 26500 },
  { min: 26750, max: 27249.99, employeeShare: 1350, employerShare: 2730, total: 4080, monthlySalaryCredit: 27000 },
  { min: 27250, max: 27749.99, employeeShare: 1375, employerShare: 2780, total: 4155, monthlySalaryCredit: 27500 },
  { min: 27750, max: 28249.99, employeeShare: 1400, employerShare: 2830, total: 4230, monthlySalaryCredit: 28000 },
  { min: 28250, max: 28749.99, employeeShare: 1425, employerShare: 2880, total: 4305, monthlySalaryCredit: 28500 },
  { min: 28750, max: 29249.99, employeeShare: 1450, employerShare: 2930, total: 4380, monthlySalaryCredit: 29000 },
  { min: 29250, max: 29749.99, employeeShare: 1475, employerShare: 2980, total: 4455, monthlySalaryCredit: 29500 },
  { min: 29750, max: null, employeeShare: 1500, employerShare: 3030, total: 4530, monthlySalaryCredit: 30000 },
];

/**
 * Get SSS contribution for a given monthly basic pay (excluding allowances).
 * Used for: payslip employee deduction (use employeeShare; for semi-monthly use employeeShare/2),
 * and for accounting when finalizing payroll (use total = employeeShare + employerShare).
 */
export function getSSSContribution(monthlyBasicPay: number): SSSContribution {
  const pay = Math.max(0, monthlyBasicPay);
  for (const bracket of SSS_TABLE_2025) {
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
  // Fallback to last bracket (above 29,750)
  const last = SSS_TABLE_2025[SSS_TABLE_2025.length - 1];
  return {
    employeeShare: last.employeeShare,
    employerShare: last.employerShare,
    total: last.total,
    monthlySalaryCredit: last.monthlySalaryCredit,
  };
}
