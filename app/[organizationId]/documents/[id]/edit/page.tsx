"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { updateDocument } from "@/actions/documents";
import { TiptapEditor } from "@/components/tiptap-editor";
import { useToast } from "@/components/ui/use-toast";
import { getOrganizationPath } from "@/utils/organization-routing";

export default function EditDocumentPage() {
  const router = useRouter();
  const params = useParams();
  const documentId = params.id as string;
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({
    title: "",
    type: "other" as const,
    category: "",
    content: JSON.stringify({ type: "doc", content: [] }),
  });

  const document = useQuery(
    (api as any).documents.getDocument,
    documentId ? { documentId: documentId as any } : "skip"
  );

  useEffect(() => {
    if (document) {
      setFormData({
        title: document.title,
        type: document.type,
        category: document.category || "",
        content:
          typeof document.content === "string"
            ? document.content
            : JSON.stringify(document.content || { type: "doc", content: [] }),
      });
      setIsLoading(false);
    }
  }, [document]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentId) return;

    if (!formData.title.trim()) {
      toast({
        title: "Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      await updateDocument(documentId, {
        title: formData.title,
        content: formData.content,
        type: formData.type,
        category: formData.category || undefined,
      });

      toast({
        title: "Success",
        description: "Document updated successfully",
      });

      router.push(getOrganizationPath(currentOrganizationId, "/documents"));
    } catch (error: any) {
      console.error("Error updating document:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update document",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <p className="text-gray-500">Loading document...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!document) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <p className="text-gray-500">Document not found</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.push("/documents")}
            >
              Back to Documents
            </Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/documents")}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Edit Document
                </h1>
              </div>
            </div>
            <Button onClick={handleSubmit} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-5xl mx-auto px-8 py-6">
            <Card>
              <CardContent className="p-6 space-y-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title *</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                      placeholder="Enter document title"
                      required
                      className="text-lg"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="type">Type *</Label>
                      <Select
                        value={formData.type}
                        onValueChange={(value: any) =>
                          setFormData({ ...formData, type: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="personal">Personal</SelectItem>
                          <SelectItem value="employment">Employment</SelectItem>
                          <SelectItem value="contract">Contract</SelectItem>
                          <SelectItem value="certificate">
                            Certificate
                          </SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        value={formData.category}
                        onChange={(e) =>
                          setFormData({ ...formData, category: e.target.value })
                        }
                        placeholder="e.g., HR Policies, Contracts, etc."
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="content">Content</Label>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <TiptapEditor
                        content={formData.content}
                        onChange={(content) =>
                          setFormData({ ...formData, content })
                        }
                      />
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
