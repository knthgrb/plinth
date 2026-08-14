"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import Image from "next/image";

interface FilePreviewDialogProps {
  previewFile: {
    url: string;
    name: string;
    type: string;
  } | null;
  previewLoading: boolean;
  onClose: () => void;
}

export function FilePreviewDialog({
  previewFile,
  previewLoading,
  onClose,
}: FilePreviewDialogProps) {
  return (
    <Dialog open={!!previewFile || previewLoading} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[90vw] min-h-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>File Preview</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {previewLoading || !previewFile ? (
            <div className="flex flex-col items-center justify-center min-h-[500px] w-full">
              <div className="w-full space-y-4">
                {/* Filename skeleton */}
                <div className="h-6 w-48 rounded bg-gray-300 animate-pulse mx-auto" />
                {/* Main content skeleton */}
                <div className="h-[500px] w-full rounded-lg bg-gray-300 animate-pulse border-2 border-gray-200" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {previewFile.type === "image" ? (
                <div className="flex items-center justify-center">
                  <Image
                    src={previewFile.url}
                    alt={previewFile.name}
                    width={1200}
                    height={800}
                    unoptimized
                    className="max-w-full max-h-[70vh] rounded-lg object-contain"
                  />
                </div>
              ) : previewFile.type === "pdf" ? (
                <iframe
                  src={previewFile.url}
                  className="w-full h-[600px] rounded-lg border"
                  title={previewFile.name}
                  onError={() => {
                    console.error("PDF failed to load:", previewFile.url);
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-8 border rounded-lg min-h-[400px]">
                  <FileText className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-gray-600 mb-4">
                    Preview not available for this file type
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => window.open(previewFile.url, "_blank")}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download File
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        {previewFile && !previewLoading && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => window.open(previewFile.url, "_blank")}
            >
              <Download className="h-4 w-4 mr-2" />
              Open in New Tab
            </Button>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
