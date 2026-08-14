import { Card, CardContent } from "@/components/ui/card";
import {
  BriefcaseBusiness,
  CircleGauge,
  Clock3,
  UserCheck,
  Users,
} from "lucide-react";
import type { RecruitmentPipelineSummary } from "@/lib/recruitment/workflow";

interface RecruitmentOverviewProps {
  summary: RecruitmentPipelineSummary;
}

const metrics = [
  {
    key: "activePositions",
    label: "Active positions",
    icon: BriefcaseBusiness,
  },
  { key: "openHeadcount", label: "Open headcount", icon: UserCheck },
  { key: "activeCandidates", label: "Active candidates", icon: Users },
  { key: "awaitingDecision", label: "Awaiting decision", icon: CircleGauge },
  { key: "staleCandidates", label: "Needs attention", icon: Clock3 },
] as const;

export function RecruitmentOverview({ summary }: RecruitmentOverviewProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map(({ key, label, icon: Icon }) => (
        <Card key={key} className="border-[#E7E5F4] shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-[#F1EFFF] p-2 text-[#695eff]">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-[#28262F]">
                {summary[key]}
              </p>
              <p className="text-xs font-medium text-[#77727F]">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
