"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  FileText,
  Edit,
  Trash2,
  Upload,
  Download,
  X,
  Search,
  Eye,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/hooks/organization-context";
import { deleteDocument } from "@/app/actions/documents";
import { generateUploadUrl, getFileUrl } from "@/app/actions/files";
import { createDocument } from "@/app/actions/documents";
import { useToast } from "@/components/ui/use-toast";

export default function DocumentsPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const documents = useQuery(
    (api as any).documents.getDocuments,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
        }
      : "skip"
  );

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [previewFileType, setPreviewFileType] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // File upload constraints
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_FILE_TYPES = [
    // Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
    "text/plain",
    "text/csv",
    // Images
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    // Archives
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
  ];
  const ALLOWED_FILE_EXTENSIONS = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".csv",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".zip",
    ".rar",
  ];
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [directUploadFiles, setDirectUploadFiles] = useState<
    Array<{
      id: string;
      file: File;
      title: string;
      category: string;
      type: "personal" | "employment" | "contract" | "certificate" | "other";
      storageId?: string;
      uploading: boolean;
    }>
  >([]);
  const directUploadInputRef = useRef<HTMLInputElement>(null);

  // Detect file type from file extension/MIME type
  const detectFileType = (
    file: File
  ): "personal" | "employment" | "contract" | "certificate" | "other" => {
    const fileName = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();

    // Contract documents
    if (
      fileName.includes("contract") ||
      fileName.includes("agreement") ||
      fileName.includes("nda") ||
      (mimeType.includes("pdf") &&
        (fileName.includes("contract") || fileName.includes("agreement")))
    ) {
      return "contract";
    }

    // Certificate documents
    if (
      fileName.includes("certificate") ||
      fileName.includes("cert") ||
      fileName.includes("diploma") ||
      fileName.includes("license")
    ) {
      return "certificate";
    }

    // Employment documents
    if (
      fileName.includes("employment") ||
      fileName.includes("offer") ||
      fileName.includes("job") ||
      fileName.includes("resume") ||
      fileName.includes("cv")
    ) {
      return "employment";
    }

    // Personal documents
    if (
      fileName.includes("personal") ||
      fileName.includes("id") ||
      fileName.includes("passport") ||
      fileName.includes("birth")
    ) {
      return "personal";
    }

    // Default to other
    return "other";
  };

  const deleteDocumentMutation = useMutation(
    (api as any).documents.deleteDocument
  );

  // Filter documents based on search and type
  const filteredDocuments = documents?.filter((doc: any) => {
    const matchesSearch =
      !searchQuery ||
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.category &&
        doc.category.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = selectedType === "all" || doc.type === selectedType;
    return matchesSearch && matchesType;
  });

  // Check if document is file-only (no content or empty content)
  const isFileOnly = (doc: any) => {
    if (!doc) return false;
    if (!doc.content) return true;
    try {
      const content =
        typeof doc.content === "string" ? JSON.parse(doc.content) : doc.content;
      return !content || !content.content || content.content.length === 0;
    } catch {
      return typeof doc.content === "string" && doc.content.trim() === "";
    }
  };

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`,
      };
    }

    // Check file type by MIME type
    const isValidMimeType = ALLOWED_FILE_TYPES.includes(file.type);

    // Check file type by extension (fallback for cases where MIME type might not be set)
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_FILE_EXTENSIONS.some((ext) =>
      fileName.endsWith(ext)
    );

    if (!isValidMimeType && !hasValidExtension) {
      return {
        valid: false,
        error: `File type not allowed. Allowed types: ${ALLOWED_FILE_EXTENSIONS.join(", ")}`,
      };
    }

    return { valid: true };
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const validFiles: File[] = [];
    const invalidFiles: Array<{ file: File; error: string }> = [];

    // Validate each file
    fileArray.forEach((file) => {
      const validation = validateFile(file);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        invalidFiles.push({ file, error: validation.error || "Invalid file" });
      }
    });

    // Show errors for invalid files
    invalidFiles.forEach(({ file, error }) => {
      toast({
        title: "File Rejected",
        description: `${file.name}: ${error}`,
        variant: "destructive",
      });
    });

    if (validFiles.length === 0) {
      return;
    }

    // Create file entries with detected type and default values
    const filesWithMetadata = validFiles.map((file) => {
      const fileName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension for title
      const detectedType = detectFileType(file);
      return {
        id: `${Date.now()}-${Math.random()}`,
        file,
        title: fileName || file.name,
        category: "",
        type: detectedType,
        uploading: false,
      };
    });

    // Add files to state
    setDirectUploadFiles((prev) => [...prev, ...filesWithMetadata]);
  };

  const handleDirectFileUpload = async () => {
    if (directUploadFiles.length === 0 || !currentOrganizationId) return;

    // Mark all as uploading
    setDirectUploadFiles((prev) =>
      prev.map((item) => ({ ...item, uploading: true }))
    );

    // Upload each file and create a document entry
    const uploadPromises = directUploadFiles.map(async (fileItem) => {
      const { file, id, title, category, type } = fileItem;
      try {
        // Upload file
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!result.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        const responseText = await result.text();
        let storageId: string;
        try {
          const jsonResponse = JSON.parse(responseText);
          storageId = jsonResponse.storageId || jsonResponse;
        } catch {
          storageId = responseText;
        }
        storageId = storageId.trim().replace(/^["']|["']$/g, "");

        // Create document entry with file metadata
        await createDocument({
          organizationId: currentOrganizationId,
          title: title || file.name,
          content: JSON.stringify({ type: "doc", content: [] }),
          type: type,
          category: category || undefined,
          attachments: [storageId],
        });

        // Update state to mark as uploaded
        setDirectUploadFiles((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, storageId, uploading: false } : item
          )
        );

        toast({
          title: "Success",
          description: `${file.name} uploaded successfully`,
        });
      } catch (error: any) {
        console.error(`Error uploading ${file.name}:`, error);
        toast({
          title: "Error",
          description: `Failed to upload ${file.name}: ${error.message}`,
          variant: "destructive",
        });
        // Remove failed file from state
        setDirectUploadFiles((prev) => prev.filter((item) => item.id !== id));
      }
    });

    // Wait for all uploads to complete
    await Promise.all(uploadPromises);

    // Clear files after a short delay
    setTimeout(() => {
      setDirectUploadFiles((prev) => {
        const allDone = prev.every((item) => !item.uploading);
        if (allDone) {
          setIsUploadDialogOpen(false);
          return [];
        }
        return prev;
      });
    }, 1500);
  };

  const handleEdit = (doc: any) => {
    router.push(`/documents/${doc._id}/edit`);
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      await deleteDocumentMutation({ documentId });
      toast({
        title: "Success",
        description: "Document deleted successfully",
      });
    } catch (error: any) {
      console.error("Error deleting document:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete document",
        variant: "destructive",
      });
    }
  };

  const handleNew = () => {
    router.push("/documents/new");
  };

  const handleDownloadFile = async (storageId: string) => {
    try {
      const url = await getFileUrl(storageId);
      window.open(url, "_blank");
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to download file",
        variant: "destructive",
      });
    }
  };

  const handlePreview = async (doc: any) => {
    setPreviewDocument(doc);
    setIsLoadingPreview(true);
    setPreviewFileUrl(null);
    setPreviewFileType(null);
    setPreviewError(false);

    // If it's a file-only document with attachments, load the first file
    if (isFileOnly(doc) && doc.attachments && doc.attachments.length > 0) {
      try {
        const url = await getFileUrl(doc.attachments[0]);
        setPreviewFileUrl(url);

        // Try to verify file type by checking Content-Type header
        let detectedType: string | null = null;
        try {
          const response = await fetch(url, { method: "HEAD" });
          const contentType = response.headers.get("content-type") || "";
          if (contentType) {
            detectedType = contentType;
          }
        } catch (e) {
          // HEAD request failed, will try URL-based detection
        }

        // If HEAD didn't give us a type, try to detect from URL
        if (!detectedType) {
          const lowerUrl = url.toLowerCase();
          if (lowerUrl.includes(".pdf") || lowerUrl.includes("pdf")) {
            detectedType = "application/pdf";
          } else if (
            lowerUrl.includes(".jpg") ||
            lowerUrl.includes(".jpeg") ||
            lowerUrl.includes("image/jpeg")
          ) {
            detectedType = "image/jpeg";
          } else if (
            lowerUrl.includes(".png") ||
            lowerUrl.includes("image/png")
          ) {
            detectedType = "image/png";
          } else if (
            lowerUrl.includes(".gif") ||
            lowerUrl.includes("image/gif")
          ) {
            detectedType = "image/gif";
          } else if (
            lowerUrl.includes(".webp") ||
            lowerUrl.includes("image/webp")
          ) {
            detectedType = "image/webp";
          } else if (
            lowerUrl.includes(".doc") ||
            lowerUrl.includes(".docx") ||
            lowerUrl.includes("application/msword") ||
            lowerUrl.includes("wordprocessingml")
          ) {
            detectedType = "application/msword";
          } else {
            // Unknown type - default to trying image (most common case)
            // This will fail gracefully if it's not an image
            detectedType = "image/*";
          }
        }

        setPreviewFileType(detectedType);
      } catch (error: any) {
        console.error("Error loading file preview:", error);
        toast({
          title: "Error",
          description: "Failed to load file preview",
          variant: "destructive",
        });
      }
    }
    setIsLoadingPreview(false);
  };

  const isPreviewableFile = (url: string | null, fileType: string | null) => {
    if (!url) return false;

    // Check by Content-Type first (most reliable)
    if (fileType) {
      const lowerType = fileType.toLowerCase();
      if (
        lowerType.includes("pdf") ||
        lowerType.includes("image/") ||
        lowerType.includes("application/msword") ||
        lowerType.includes("wordprocessingml") ||
        lowerType.includes(
          "application/vnd.openxmlformats-officedocument.wordprocessingml"
        )
      ) {
        return true;
      }
    }

    // Fallback to URL checking
    const lowerUrl = url.toLowerCase();
    const previewableExtensions = [
      ".pdf",
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".doc",
      ".docx",
    ];

    // If URL contains any previewable extension, allow preview
    if (previewableExtensions.some((ext) => lowerUrl.includes(ext))) {
      return true;
    }

    // If fileType is "image/*" (our default for unknown types), allow preview attempt
    if (fileType === "image/*") {
      return true;
    }

    return false;
  };

  const getPreviewComponent = (url: string, fileType: string | null) => {
    const lowerType = fileType?.toLowerCase() || "";
    const lowerUrl = url.toLowerCase();

    // PDF files
    if (
      lowerType.includes("pdf") ||
      lowerUrl.includes(".pdf") ||
      lowerUrl.includes("application/pdf")
    ) {
      return (
        <iframe
          src={url}
          className="w-full h-[600px] rounded-lg border-0"
          title={previewDocument?.title}
          onError={() => {
            console.error("PDF failed to load:", url);
          }}
        />
      );
    }

    // DOC/DOCX files - use Google Docs Viewer or Office Online
    if (
      lowerType.includes("msword") ||
      lowerType.includes("wordprocessingml") ||
      lowerType.includes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml"
      ) ||
      lowerUrl.includes(".doc") ||
      lowerUrl.includes(".docx")
    ) {
      // Use Google Docs Viewer for DOC files (may not work with authenticated URLs)
      // Fallback: show download option
      const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
      return (
        <div className="space-y-4">
          <iframe
            src={viewerUrl}
            className="w-full h-[600px] rounded-lg border-0"
            title={previewDocument?.title}
            onError={() => {
              console.error("Document viewer failed to load:", url);
            }}
          />
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            <p>
              <strong>Note:</strong> If the document doesn't load above, please
              download the file to view it.
            </p>
          </div>
        </div>
      );
    }

    // Image files - try image first (most common case)
    // If fileType is null/unknown, try as image (will fail gracefully if not)
    const isLikelyImage =
      lowerType.includes("image/") ||
      lowerUrl.includes(".jpg") ||
      lowerUrl.includes(".jpeg") ||
      lowerUrl.includes(".png") ||
      lowerUrl.includes(".gif") ||
      lowerUrl.includes(".webp") ||
      fileType === "image/*" ||
      (!fileType && !lowerUrl.includes(".pdf") && !lowerUrl.includes(".doc")); // Unknown type, try image

    if (isLikelyImage) {
      return (
        <img
          src={url}
          alt={previewDocument?.title}
          className="w-full h-auto max-h-[600px] object-contain"
          onError={() => {
            console.error("Image failed to load:", url);
            setPreviewError(true);
          }}
        />
      );
    }

    return null;
  };

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
            <p className="text-gray-600 mt-2">
              Manage and store your organization documents and files
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleNew}>
              <Plus className="mr-2 h-4 w-4" />
              Create Document
            </Button>
            <Button onClick={() => setIsUploadDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
          </div>
        </div>

        <Card className="mb-4">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Search Documents</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by title or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Filter by Type</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="employment">Employment</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="certificate">Certificate</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents ({filteredDocuments?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredDocuments?.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>
                  {documents?.length === 0
                    ? "No documents yet. Create your first document!"
                    : "No documents match your search criteria."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments?.map((doc: any) => {
                    const fileOnly = isFileOnly(doc);
                    return (
                      <TableRow
                        key={doc._id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handlePreview(doc)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {fileOnly && (
                              <FileText className="h-4 w-4 text-gray-400" />
                            )}
                            {doc.title}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="capitalize">
                              {doc.type}
                            </Badge>
                            {fileOnly && (
                              <Badge variant="outline" className="text-xs">
                                File
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{doc.category || "-"}</TableCell>
                        <TableCell>
                          {doc.attachments && doc.attachments.length > 0 ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {doc.attachments.length} file
                                {doc.attachments.length > 1 ? "s" : ""}
                              </Badge>
                              <div className="flex gap-1">
                                {doc.attachments.map(
                                  (fileId: string, idx: number) => (
                                    <Button
                                      key={idx}
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDownloadFile(fileId)}
                                      className="h-6 px-2"
                                      title="Download file"
                                    >
                                      <Download className="h-3 w-3" />
                                    </Button>
                                  )
                                )}
                              </div>
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {format(new Date(doc.createdAt), "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell>
                          {format(new Date(doc.updatedAt), "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePreview(doc);
                              }}
                              title="Preview"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(doc);
                              }}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(doc._id);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Direct File Upload Dialog */}
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Files</DialogTitle>
              <DialogDescription>
                Upload files directly to your document storage. Configure each
                file's details before uploading.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* File Upload Limits Notice */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-blue-900">
                      File Upload Requirements
                    </p>
                    <div className="text-xs text-blue-800 space-y-1">
                      <p>
                        <strong>Maximum file size:</strong>{" "}
                        {MAX_FILE_SIZE / (1024 * 1024)}MB per file
                      </p>
                      <p>
                        <strong>Allowed file types:</strong> PDF, DOC, DOCX,
                        XLS, XLSX, PPT, PPTX, TXT, CSV, JPG, JPEG, PNG, GIF,
                        WEBP, ZIP, RAR
                      </p>
                      <p className="text-blue-700 mt-2">
                        <strong>Note:</strong> PDF, DOC, DOCX, and image files
                        (JPG, PNG, GIF, WEBP) can be previewed. Other file types
                        can be downloaded.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8">
                <input
                  ref={directUploadInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files)}
                />
                <div className="flex flex-col items-center justify-center gap-4">
                  <Upload className="h-12 w-12 text-gray-400" />
                  <div className="text-center">
                    <Button
                      type="button"
                      onClick={() => directUploadInputRef.current?.click()}
                      disabled={directUploadFiles.some((f) => f.uploading)}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Select Files
                    </Button>
                    <p className="text-xs text-gray-500 mt-2">
                      Click to select files or drag and drop
                    </p>
                  </div>
                </div>
              </div>

              {directUploadFiles.length > 0 && (
                <div className="space-y-4">
                  <Label>Configure Files:</Label>
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {directUploadFiles.map((item, index) => (
                      <Card key={item.id} className="p-4">
                        <div className="space-y-4">
                          <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-gray-600" />
                            <div className="flex-1">
                              <span className="font-medium text-sm">
                                {item.file.name}
                              </span>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                              </p>
                            </div>
                            {item.uploading && (
                              <Badge variant="outline" className="text-xs">
                                Uploading...
                              </Badge>
                            )}
                            {item.storageId && (
                              <Badge
                                variant="outline"
                                className="text-xs bg-green-50"
                              >
                                Uploaded
                              </Badge>
                            )}
                            {!item.uploading && !item.storageId && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setDirectUploadFiles((prev) =>
                                    prev.filter((file) => file.id !== item.id)
                                  )
                                }
                                className="ml-auto h-6 px-2 hover:bg-red-100"
                              >
                                <X className="h-3 w-3 text-red-600" />
                              </Button>
                            )}
                          </div>

                          {!item.uploading && !item.storageId && (
                            <>
                              <div className="space-y-2">
                                <Label htmlFor={`title-${item.id}`}>
                                  Title *
                                </Label>
                                <Input
                                  id={`title-${item.id}`}
                                  value={item.title}
                                  onChange={(e) =>
                                    setDirectUploadFiles((prev) =>
                                      prev.map((file) =>
                                        file.id === item.id
                                          ? { ...file, title: e.target.value }
                                          : file
                                      )
                                    )
                                  }
                                  placeholder="Enter file title"
                                  required
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor={`type-${item.id}`}>
                                    Type *
                                  </Label>
                                  <Select
                                    value={item.type}
                                    onValueChange={(value: any) =>
                                      setDirectUploadFiles((prev) =>
                                        prev.map((file) =>
                                          file.id === item.id
                                            ? { ...file, type: value }
                                            : file
                                        )
                                      )
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="personal">
                                        Personal
                                      </SelectItem>
                                      <SelectItem value="employment">
                                        Employment
                                      </SelectItem>
                                      <SelectItem value="contract">
                                        Contract
                                      </SelectItem>
                                      <SelectItem value="certificate">
                                        Certificate
                                      </SelectItem>
                                      <SelectItem value="other">
                                        Other
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <Label htmlFor={`category-${item.id}`}>
                                    Category
                                  </Label>
                                  <Input
                                    id={`category-${item.id}`}
                                    value={item.category}
                                    onChange={(e) =>
                                      setDirectUploadFiles((prev) =>
                                        prev.map((file) =>
                                          file.id === item.id
                                            ? {
                                                ...file,
                                                category: e.target.value,
                                              }
                                            : file
                                        )
                                      )
                                    }
                                    placeholder="e.g., HR Policies, Contracts"
                                  />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsUploadDialogOpen(false);
                  setDirectUploadFiles([]);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleDirectFileUpload}
                disabled={
                  directUploadFiles.length === 0 ||
                  directUploadFiles.some((f) => f.uploading) ||
                  directUploadFiles.some((f) => !f.title.trim())
                }
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload{" "}
                {directUploadFiles.length > 0
                  ? `${directUploadFiles.length} `
                  : ""}
                File{directUploadFiles.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Document Preview Dialog */}
        <Dialog
          open={previewDocument !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewDocument(null);
              setPreviewFileUrl(null);
            }
          }}
        >
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{previewDocument?.title}</DialogTitle>
              <DialogDescription>
                {previewDocument?.category && (
                  <span className="mr-2">
                    Category: {previewDocument.category}
                  </span>
                )}
                <span className="capitalize">
                  Type: {previewDocument?.type}
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {isLoadingPreview ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-gray-500">Loading preview...</p>
                </div>
              ) : (
                <>
                  {/* File Preview (for file-only documents) */}
                  {previewDocument &&
                  isFileOnly(previewDocument) &&
                  previewDocument?.attachments &&
                  previewDocument.attachments.length > 0 ? (
                    <div className="space-y-4">
                      {previewFileUrl &&
                      isPreviewableFile(previewFileUrl, previewFileType) ? (
                        <div className="border rounded-lg overflow-hidden bg-gray-50">
                          {previewError ? (
                            <div className="flex flex-col items-center justify-center p-8 min-h-[400px]">
                              <FileText className="h-16 w-16 text-gray-400 mb-4" />
                              <p className="text-gray-600 mb-4">
                                Preview not available for this file type
                              </p>
                              <Button
                                variant="outline"
                                onClick={() =>
                                  previewFileUrl &&
                                  window.open(previewFileUrl, "_blank")
                                }
                              >
                                <Download className="h-4 w-4 mr-2" />
                                Download File
                              </Button>
                            </div>
                          ) : (
                            getPreviewComponent(
                              previewFileUrl,
                              previewFileType
                            ) || (
                              <div className="flex flex-col items-center justify-center p-8 min-h-[400px]">
                                <FileText className="h-16 w-16 text-gray-400 mb-4" />
                                <p className="text-gray-600 mb-4">
                                  Unable to render preview
                                </p>
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    previewFileUrl &&
                                    window.open(previewFileUrl, "_blank")
                                  }
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  Download File
                                </Button>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center p-8 border rounded-lg min-h-[400px]">
                          <FileText className="h-16 w-16 text-gray-400 mb-4" />
                          <p className="text-gray-600 mb-4">
                            Preview not available for this file type
                          </p>
                          <Button
                            variant="outline"
                            onClick={() =>
                              previewFileUrl &&
                              window.open(previewFileUrl, "_blank")
                            }
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download File
                          </Button>
                        </div>
                      )}
                      {previewDocument.attachments.length > 1 && (
                        <div className="space-y-2">
                          <Label>Other Files:</Label>
                          <div className="flex flex-wrap gap-2">
                            {previewDocument.attachments
                              .slice(1)
                              .map((fileId: string, idx: number) => (
                                <Button
                                  key={idx}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDownloadFile(fileId)}
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  File {idx + 2}
                                </Button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Document Content Preview (for documents with content) */
                    <div className="border rounded-lg p-6 bg-white min-h-[200px]">
                      {previewDocument?.content ? (
                        <div className="prose prose-sm max-w-none">
                          {(() => {
                            try {
                              const content =
                                typeof previewDocument.content === "string"
                                  ? JSON.parse(previewDocument.content)
                                  : previewDocument.content;

                              const renderNode = (node: any): string => {
                                if (!node) return "";

                                if (node.type === "paragraph") {
                                  const text = node.content
                                    ? node.content
                                        .map((c: any) => {
                                          if (c.type === "text") {
                                            let text = c.text || "";
                                            if (c.marks) {
                                              c.marks.forEach((mark: any) => {
                                                if (mark.type === "bold") {
                                                  text = `<strong>${text}</strong>`;
                                                } else if (
                                                  mark.type === "italic"
                                                ) {
                                                  text = `<em>${text}</em>`;
                                                }
                                              });
                                            }
                                            return text;
                                          }
                                          return renderNode(c);
                                        })
                                        .join("")
                                    : "";
                                  return `<p>${text || ""}</p>`;
                                }

                                if (node.type === "heading") {
                                  const level = node.attrs?.level || 1;
                                  const text = node.content
                                    ? node.content
                                        .map((c: any) => c.text || "")
                                        .join("")
                                    : "";
                                  return `<h${level}>${text}</h${level}>`;
                                }

                                if (node.type === "bulletList") {
                                  const items = node.content
                                    ? node.content
                                        .map((c: any) => renderNode(c))
                                        .join("")
                                    : "";
                                  return `<ul>${items}</ul>`;
                                }

                                if (node.type === "orderedList") {
                                  const items = node.content
                                    ? node.content
                                        .map((c: any) => renderNode(c))
                                        .join("")
                                    : "";
                                  return `<ol>${items}</ol>`;
                                }

                                if (node.type === "listItem") {
                                  const text = node.content
                                    ? node.content
                                        .map((c: any) => renderNode(c))
                                        .join("")
                                    : "";
                                  return `<li>${text}</li>`;
                                }

                                if (node.type === "text") {
                                  let text = node.text || "";
                                  if (node.marks) {
                                    node.marks.forEach((mark: any) => {
                                      if (mark.type === "bold") {
                                        text = `<strong>${text}</strong>`;
                                      } else if (mark.type === "italic") {
                                        text = `<em>${text}</em>`;
                                      } else if (mark.type === "link") {
                                        text = `<a href="${mark.attrs?.href || "#"}" target="_blank" class="text-purple-600 underline">${text}</a>`;
                                      }
                                    });
                                  }
                                  return text;
                                }

                                if (node.content) {
                                  return node.content
                                    .map((c: any) => renderNode(c))
                                    .join("");
                                }

                                return "";
                              };

                              const html = content.content
                                ? content.content
                                    .map((node: any) => renderNode(node))
                                    .join("")
                                : "<p>No content</p>";

                              return (
                                <div
                                  dangerouslySetInnerHTML={{
                                    __html: html || "<p>No content</p>",
                                  }}
                                />
                              );
                            } catch (error) {
                              console.error("Error rendering content:", error);
                              return (
                                <div className="text-center py-8 text-gray-500">
                                  <p>Unable to render content</p>
                                </div>
                              );
                            }
                          })()}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <p>No content to display</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              {previewFileUrl && (
                <Button
                  variant="outline"
                  onClick={() => window.open(previewFileUrl, "_blank")}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Open in New Tab
                </Button>
              )}
              {!isFileOnly(previewDocument) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (previewDocument) {
                      handleEdit(previewDocument);
                    }
                  }}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Document
                </Button>
              )}
              <Button
                onClick={() => {
                  setPreviewDocument(null);
                  setPreviewFileUrl(null);
                  setPreviewFileType(null);
                  setPreviewError(false);
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
