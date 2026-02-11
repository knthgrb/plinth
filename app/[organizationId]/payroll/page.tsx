import { getPayrollRuns } from "@/actions/payroll";
import PayrollPageClient from "./payroll-page-client";

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function PayrollPage({ params }: PageProps) {
  const { organizationId } = await params;
  const initialPayrollRuns = await getPayrollRuns(organizationId);
  return <PayrollPageClient initialPayrollRuns={initialPayrollRuns} />;
}
