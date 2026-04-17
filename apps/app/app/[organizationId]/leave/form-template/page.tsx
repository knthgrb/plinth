"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, RotateCcw, Save } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { TiptapEditor } from "@/components/tiptap-editor";
import { TiptapViewer } from "@/components/tiptap-viewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import {
  DEFAULT_LEAVE_REQUEST_TEMPLATE,
  LEAVE_REQUEST_TEMPLATE_PLACEHOLDERS,
  LEAVE_REQUEST_TEMPLATE_SECTIONS,
} from "@/components/leave/leave-request-template";
import { LeavePdfLayoutEditor } from "@/components/leave/leave-pdf-layout-editor";
import {
  DEFAULT_LEAVE_PDF_LAYOUT,
  normalizeLeavePdfLayout,
  type LeavePdfLayout,
} from "@/lib/leave-pdf-layout";
import { getOrganizationPath } from "@/utils/organization-routing";

type TiptapDoc = {
  type: string;
  content?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

function appendBlocks(content: string, blocks: Array<Record<string, unknown>>) {
  try {
    const parsed = JSON.parse(content) as TiptapDoc;
    const currentContent = Array.isArray(parsed.content) ? parsed.content : [];
    return JSON.stringify({
      ...parsed,
      content: [...currentContent, ...blocks],
    });
  } catch {
    const fallback = JSON.parse(DEFAULT_LEAVE_REQUEST_TEMPLATE) as TiptapDoc;
    return JSON.stringify({
      ...fallback,
      content: [...(fallback.content ?? []), ...blocks],
    });
  }
}

export default function LeaveFormTemplatePage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const settings = useQuery(
    api.settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const updateLeaveTypes = useMutation(api.settings.updateLeaveTypes);

  const [templateContent, setTemplateContent] = useState(
    DEFAULT_LEAVE_REQUEST_TEMPLATE,
  );
  const [pdfLayout, setPdfLayout] = useState<LeavePdfLayout>(
    DEFAULT_LEAVE_PDF_LAYOUT,
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setTemplateContent(
        settings.leaveRequestFormTemplate ?? DEFAULT_LEAVE_REQUEST_TEMPLATE,
      );
      setPdfLayout(
        normalizeLeavePdfLayout(
          (settings as { leaveRequestPdfLayout?: LeavePdfLayout })
            .leaveRequestPdfLayout,
        ),
      );
    }
  }, [settings]);

  const copyPlaceholder = async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder);
      toast({
        title: "Placeholder copied",
        description: `${placeholder} copied to your clipboard.`,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Please copy the placeholder manually.",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!currentOrganizationId || !settings) return;

    setIsSaving(true);
    try {
      await updateLeaveTypes({
        organizationId: currentOrganizationId,
        proratedLeave: settings.proratedLeave ?? true,
        annualSil: settings.annualSil ?? 8,
        grantLeaveUponRegularization:
          settings.grantLeaveUponRegularization ?? true,
        leaveRequestFormTemplate: templateContent,
        leaveRequestPdfLayout: pdfLayout,
      });

      toast({
        title: "Template updated",
        description: "Leave request form template saved successfully.",
      });
      router.push(getOrganizationPath(currentOrganizationId, "/leave"));
    } catch (error: unknown) {
      toast({
        title: "Failed to save template",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex h-screen flex-col">
        <div className="border-b border-gray-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  router.push(getOrganizationPath(currentOrganizationId, "/leave"))
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Edit Leave Request Form
                </h1>
                <p className="text-sm text-gray-500">
                  Customize the default form employees will fill before
                  submitting a leave request.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplateContent(DEFAULT_LEAVE_REQUEST_TEMPLATE)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset default
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Saving..." : "Save form"}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="mx-auto grid max-w-7xl gap-6 px-8 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Template tools</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Placeholders</Label>
                  <div className="flex flex-wrap gap-2">
                    {LEAVE_REQUEST_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() => copyPlaceholder(placeholder)}
                        className="rounded bg-[rgb(245,245,245)] px-2 py-1 text-left text-xs transition-colors hover:bg-[rgb(235,235,235)]"
                      >
                        {placeholder}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    Click any placeholder to copy it, then paste it anywhere in
                    the form.
                  </p>
                </div>

                <LeavePdfLayoutEditor value={pdfLayout} onChange={setPdfLayout} />

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Quick sections</Label>
                  <div className="space-y-2">
                    {LEAVE_REQUEST_TEMPLATE_SECTIONS.map((section) => (
                      <div
                        key={section.id}
                        className="rounded-lg border border-[rgb(230,230,230)] p-3"
                      >
                        <p className="text-sm font-medium text-[rgb(64,64,64)]">
                          {section.label}
                        </p>
                        <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                          {section.description}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-3 w-full justify-start"
                          onClick={() =>
                            setTemplateContent((current) =>
                              appendBlocks(current, section.blocks),
                            )
                          }
                        >
                          Insert section
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Form editor</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <TiptapEditor
                    content={templateContent}
                    onChange={setTemplateContent}
                    placeholder="Build the leave request form here..."
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Live preview</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="rounded-lg border border-[rgb(230,230,230)] bg-white">
                    <TiptapViewer content={templateContent} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
