"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { FileText, Check } from "lucide-react";

interface DocumentSelectorModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (storageIds: string[]) => void;
}

export function DocumentSelectorModal({
  isOpen,
  onOpenChange,
  onSelect,
}: DocumentSelectorModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);

  const documents = useQuery(
    (api as any).documents.getDocuments,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const filteredDocuments = documents?.filter((doc: any) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      doc.title?.toLowerCase().includes(searchLower) ||
      doc.type?.toLowerCase().includes(searchLower)
    );
  });

  const toggleDocument = (docId: string) => {
    setSelectedDocuments((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId]
    );
  };

  const handleSubmit = () => {
    if (selectedDocuments.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one document",
        variant: "destructive",
      });
      return;
    }

    // Get all attachment storage IDs from selected documents
    const allAttachments: string[] = [];
    selectedDocuments.forEach((docId) => {
      const doc = documents?.find((d: any) => d._id === docId);
      if (doc?.attachments) {
        allAttachments.push(...doc.attachments);
      }
    });

    if (allAttachments.length === 0) {
      toast({
        title: "No Attachments",
        description: "Selected documents don't have any file attachments",
        variant: "destructive",
      });
      return;
    }

    onSelect(allAttachments);
    setSelectedDocuments([]);
    setSearchQuery("");
    onOpenChange(false);
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedDocuments([]);
      setSearchQuery("");
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select Documents</DialogTitle>
          <DialogDescription>
            Choose documents from your organization to attach to the message.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="space-y-2">
            <Label>Search Documents</Label>
            <Input
              placeholder="Search by title or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-96 overflow-y-auto border rounded-md p-2 space-y-1">
              {filteredDocuments && filteredDocuments.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (
                          selectedDocuments.length === filteredDocuments.length
                        ) {
                          setSelectedDocuments([]);
                        } else {
                          setSelectedDocuments(
                            filteredDocuments.map((d: any) => d._id)
                          );
                        }
                      }}
                    >
                      {selectedDocuments.length === filteredDocuments.length
                        ? "Deselect All"
                        : "Select All"}
                    </Button>
                  </div>
                  {filteredDocuments.map((doc: any) => {
                    const hasAttachments =
                      doc.attachments && doc.attachments.length > 0;
                    return (
                      <label
                        key={doc._id}
                        className={`flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer ${
                          !hasAttachments ? "opacity-50" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocuments.includes(doc._id)}
                          onChange={() => toggleDocument(doc._id)}
                          disabled={!hasAttachments}
                          className="h-4 w-4 accent-purple-600"
                        />
                        <FileText className="h-5 w-5 text-gray-400" />
                        <div className="flex-1">
                          <div className="text-sm font-medium">{doc.title}</div>
                          <div className="text-xs text-gray-500">
                            {doc.type} • {doc.attachments?.length || 0} file(s)
                          </div>
                        </div>
                        {selectedDocuments.includes(doc._id) && (
                          <Check className="h-4 w-4 text-purple-600" />
                        )}
                      </label>
                    );
                  })}
                </>
              ) : (
                <p className="text-sm text-gray-500 p-2">
                  {searchQuery
                    ? "No documents found matching your search"
                    : "No documents available"}
                </p>
              )}
            </div>
            {selectedDocuments.length > 0 && (
              <p className="text-sm text-gray-500">
                {selectedDocuments.length} document(s) selected
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedDocuments.length === 0}
          >
            Attach Files
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
