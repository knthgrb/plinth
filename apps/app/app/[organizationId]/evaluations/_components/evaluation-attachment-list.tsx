"use client";

import { useState } from "react";
import { getEvaluationAttachmentUrl } from "@/actions/evaluations";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Download, Loader2, Paperclip } from "lucide-react";

type EvaluationAttachmentListProps = {
  evaluationId: string;
  attachmentIds: string[];
};

export function EvaluationAttachmentList({
  evaluationId,
  attachmentIds,
}: EvaluationAttachmentListProps) {
  const { toast } = useToast();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openAttachment = async (storageId: string) => {
    try {
      setOpeningId(storageId);
      const url = await getEvaluationAttachmentUrl(evaluationId, storageId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      toast({
        title: "Unable to open attachment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setOpeningId(null);
    }
  };

  if (attachmentIds.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[rgb(110,110,110)]">
        <Paperclip className="h-3.5 w-3.5" /> Attachments
      </p>
      <div className="flex flex-wrap gap-2">
        {attachmentIds.map((storageId, index) => (
          <Button
            key={storageId}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openAttachment(storageId)}
            disabled={openingId === storageId}
          >
            {openingId === storageId ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            File {index + 1}
          </Button>
        ))}
      </div>
    </div>
  );
}
