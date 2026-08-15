import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "convex/react";
import { EvaluationsContent } from "../app/[organizationId]/evaluations/_components/evaluations-content";
import RequirementsPage from "../app/[organizationId]/requirements/page";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("@/hooks/organization-context", () => ({
  useOrganization: () => ({
    currentOrganizationId: "organization-1",
    effectiveOrganizationId: "organization-1",
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/actions/employees", () => ({
  updateRequirementFile: vi.fn(),
}));

vi.mock("@/actions/files", () => ({
  getFileUrl: vi.fn(),
}));

vi.mock("@/actions/organizations", () => ({
  updateDefaultRequirements: vi.fn(),
}));

vi.mock("@/lib/storage-upload", () => ({
  uploadFileToStorage: vi.fn(),
}));

vi.mock(
  "@/app/[organizationId]/evaluations/_components/evaluation-editor-dialog",
  () => ({ EvaluationEditorDialog: () => null }),
);

vi.mock(
  "@/app/[organizationId]/evaluations/_components/evaluation-history-dialog",
  () => ({ EvaluationHistoryDialog: () => null }),
);

vi.mock(
  "@/app/[organizationId]/requirements/_components/requirements-column-management-modal",
  () => ({ RequirementsColumnManagementModal: () => null }),
);

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

const queryMock = vi.mocked(useQuery);
const semanticAccentPattern =
  /(?:bg|text|border)-(?:red|orange|amber|yellow|blue|indigo|green|emerald|teal|cyan|sky|rose)-\d+/;

describe("brand summary cards", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("uses only brand-purple accents for evaluation summaries", () => {
    queryMock.mockReturnValueOnce({ role: "owner" });
    queryMock.mockReturnValueOnce(undefined);

    const markup = renderToStaticMarkup(
      React.createElement(EvaluationsContent),
    );

    expect(markup).not.toMatch(semanticAccentPattern);
    expect(
      markup.match(/bg-brand-purple\/10[^"]*text-brand-purple/g) ?? [],
    ).toHaveLength(4);
  });

  it("uses only brand-purple accents for requirement summaries", () => {
    queryMock.mockReturnValueOnce({ role: "manager" });
    queryMock.mockReturnValueOnce([]);
    queryMock.mockReturnValueOnce([]);
    queryMock.mockReturnValueOnce({});
    queryMock.mockReturnValueOnce(undefined);

    const markup = renderToStaticMarkup(React.createElement(RequirementsPage));

    expect(markup).not.toMatch(semanticAccentPattern);
    expect(
      markup.match(/bg-brand-purple\/10[^"]*text-brand-purple/g) ?? [],
    ).toHaveLength(4);
  });
});
