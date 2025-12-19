"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Edit,
  Trash2,
  Package,
  AlertCircle,
  Calendar,
  Search,
} from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import {
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
} from "@/app/actions/assets";
import { useToast } from "@/components/ui/use-toast";
import { format } from "date-fns";

export default function AssetsPage() {
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAssetId, setDeleteAssetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    quantity: "",
    unitPrice: "",
    totalValue: "",
    datePurchased: "",
    supplier: "",
    serialNumber: "",
    location: "",
    status: "active" as "active" | "inactive" | "disposed" | "maintenance",
    notes: "",
  });

  // Load assets
  useEffect(() => {
    if (!currentOrganizationId) return;
    loadAssets();
  }, [currentOrganizationId]);

  const loadAssets = async () => {
    if (!currentOrganizationId) return;
    try {
      setLoading(true);
      const data = await getAssets(currentOrganizationId);
      setAssets(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load assets",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (asset?: any) => {
    if (asset) {
      setEditingAsset(asset);
      setFormData({
        name: asset.name || "",
        description: asset.description || "",
        category: asset.category || "",
        quantity: asset.quantity?.toString() || "",
        unitPrice: asset.unitPrice?.toString() || "",
        totalValue: asset.totalValue?.toString() || "",
        datePurchased: asset.datePurchased
          ? format(new Date(asset.datePurchased), "yyyy-MM-dd")
          : "",
        supplier: asset.supplier || "",
        serialNumber: asset.serialNumber || "",
        location: asset.location || "",
        status: asset.status || "active",
        notes: asset.notes || "",
      });
    } else {
      setEditingAsset(null);
      setFormData({
        name: "",
        description: "",
        category: "",
        quantity: "",
        unitPrice: "",
        totalValue: "",
        datePurchased: "",
        supplier: "",
        serialNumber: "",
        location: "",
        status: "active",
        notes: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingAsset(null);
    setFormData({
      name: "",
      description: "",
      category: "",
      quantity: "",
      unitPrice: "",
      totalValue: "",
      datePurchased: "",
      supplier: "",
      serialNumber: "",
      location: "",
      status: "active",
      notes: "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;

    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Asset name is required",
        variant: "destructive",
      });
      return;
    }

    const quantity = parseFloat(formData.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast({
        title: "Validation Error",
        description: "Quantity must be a positive number",
        variant: "destructive",
      });
      return;
    }

    try {
      const unitPrice = formData.unitPrice
        ? parseFloat(formData.unitPrice)
        : undefined;
      const totalValue = formData.totalValue
        ? parseFloat(formData.totalValue)
        : unitPrice
          ? unitPrice * quantity
          : undefined;
      const datePurchased = formData.datePurchased
        ? new Date(formData.datePurchased).getTime()
        : undefined;

      if (editingAsset) {
        await updateAsset(editingAsset._id, {
          name: formData.name,
          description: formData.description || undefined,
          category: formData.category || undefined,
          quantity: quantity,
          unitPrice: unitPrice,
          totalValue: totalValue,
          datePurchased: datePurchased,
          supplier: formData.supplier || undefined,
          serialNumber: formData.serialNumber || undefined,
          location: formData.location || undefined,
          status: formData.status,
          notes: formData.notes || undefined,
        });
        toast({
          title: "Success",
          description: "Asset updated successfully",
        });
      } else {
        await createAsset({
          organizationId: currentOrganizationId,
          name: formData.name,
          description: formData.description || undefined,
          category: formData.category || undefined,
          quantity: quantity,
          unitPrice: unitPrice,
          totalValue: totalValue,
          datePurchased: datePurchased,
          supplier: formData.supplier || undefined,
          serialNumber: formData.serialNumber || undefined,
          location: formData.location || undefined,
          status: formData.status,
          notes: formData.notes || undefined,
        });
        toast({
          title: "Success",
          description: "Asset created successfully",
        });
      }

      handleCloseDialog();
      await loadAssets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save asset",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteAssetId) return;

    setDeleting(true);
    try {
      await deleteAsset(deleteAssetId);
      toast({
        title: "Success",
        description: "Asset deleted successfully",
      });
      setDeleteDialogOpen(false);
      setDeleteAssetId(null);
      await loadAssets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete asset",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "inactive":
        return "secondary";
      case "maintenance":
        return "outline";
      case "disposed":
        return "destructive";
      default:
        return "outline";
    }
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "-";
    return format(new Date(timestamp), "MMM dd, yyyy");
  };

  // Filter assets based on search query
  const filteredAssets = assets.filter((asset) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      asset.name?.toLowerCase().includes(query) ||
      asset.category?.toLowerCase().includes(query) ||
      asset.serialNumber?.toLowerCase().includes(query) ||
      asset.location?.toLowerCase().includes(query) ||
      asset.supplier?.toLowerCase().includes(query)
    );
  });

  // Calculate total value of all assets
  const totalAssetsValue = assets.reduce((sum, asset) => {
    return sum + (asset.totalValue || asset.unitPrice * asset.quantity || 0);
  }, 0);

  const totalQuantity = assets.reduce((sum, asset) => {
    return sum + (asset.quantity || 0);
  }, 0);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </MainLayout>
    );
  }

  return (
    <>
      <MainLayout>
        <div className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">
              Assets Management
            </h1>
            <p className="text-gray-600 mt-2">
              Track and manage company assets including equipment, furniture,
              and other resources
            </p>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Assets
                </CardTitle>
                <Package className="h-4 w-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{assets.length}</div>
                <p className="text-xs text-gray-500">Asset records</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Quantity
                </CardTitle>
                <Package className="h-4 w-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalQuantity}</div>
                <p className="text-xs text-gray-500">Total units</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Value
                </CardTitle>
                <Package className="h-4 w-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ₱{totalAssetsValue.toLocaleString()}
                </div>
                <p className="text-xs text-gray-500">Combined asset value</p>
              </CardContent>
            </Card>
          </div>

          {/* Assets Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Assets</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Manage your organization's assets
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search assets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 w-64"
                    />
                  </div>
                  <Button onClick={() => handleOpenDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Asset
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredAssets.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>
                    {searchQuery
                      ? "No assets found matching your search."
                      : "No assets yet. Add your first asset above."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Unit Price</TableHead>
                        <TableHead>Total Value</TableHead>
                        <TableHead>Date Purchased</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAssets.map((asset) => (
                        <TableRow key={asset._id}>
                          <TableCell className="font-medium">
                            <div>
                              {asset.name}
                              {asset.serialNumber && (
                                <p className="text-xs text-gray-500 mt-1">
                                  SN: {asset.serialNumber}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {asset.category ? (
                              <Badge variant="outline">{asset.category}</Badge>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell>{asset.quantity || 0}</TableCell>
                          <TableCell>
                            {asset.unitPrice
                              ? `₱${asset.unitPrice.toLocaleString()}`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">
                              ₱
                              {(
                                asset.totalValue ||
                                (asset.unitPrice || 0) * (asset.quantity || 0)
                              ).toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-gray-400" />
                              <span className="text-sm">
                                {formatDate(asset.datePurchased)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {asset.location || (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusColor(asset.status)}>
                              {asset.status?.charAt(0).toUpperCase() +
                                asset.status?.slice(1) || "Active"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenDialog(asset)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setDeleteAssetId(asset._id);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add/Edit Asset Dialog */}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingAsset ? "Edit Asset" : "Add Asset"}
                </DialogTitle>
                <DialogDescription>
                  {editingAsset
                    ? "Update the asset details"
                    : "Add a new asset to your inventory"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Asset Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        required
                        placeholder="e.g., Laptop, Office Chair"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        value={formData.category}
                        onChange={(e) =>
                          setFormData({ ...formData, category: e.target.value })
                        }
                        placeholder="e.g., IT Equipment, Furniture"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Asset description"
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="quantity">Quantity *</Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="1"
                        step="1"
                        value={formData.quantity}
                        onChange={(e) =>
                          setFormData({ ...formData, quantity: e.target.value })
                        }
                        required
                        placeholder="1"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="unitPrice">Unit Price (₱)</Label>
                      <Input
                        id="unitPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.unitPrice}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            unitPrice: e.target.value,
                          })
                        }
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="totalValue">Total Value (₱)</Label>
                      <Input
                        id="totalValue"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.totalValue}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            totalValue: e.target.value,
                          })
                        }
                        placeholder="Auto-calculated"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="datePurchased">Date Purchased</Label>
                      <Input
                        id="datePurchased"
                        type="date"
                        value={formData.datePurchased}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            datePurchased: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={formData.status}
                        onValueChange={(value: any) =>
                          setFormData({ ...formData, status: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="maintenance">
                            Maintenance
                          </SelectItem>
                          <SelectItem value="disposed">Disposed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="supplier">Supplier</Label>
                      <Input
                        id="supplier"
                        value={formData.supplier}
                        onChange={(e) =>
                          setFormData({ ...formData, supplier: e.target.value })
                        }
                        placeholder="Vendor/Supplier name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="serialNumber">Serial Number</Label>
                      <Input
                        id="serialNumber"
                        value={formData.serialNumber}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            serialNumber: e.target.value,
                          })
                        }
                        placeholder="Serial number if applicable"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={formData.location}
                      onChange={(e) =>
                        setFormData({ ...formData, location: e.target.value })
                      }
                      placeholder="Where the asset is located"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      placeholder="Additional notes about this asset"
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseDialog}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingAsset ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Asset?</DialogTitle>
                <DialogDescription>
                  This action cannot be undone and will permanently remove this
                  asset record.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteDialogOpen(false);
                    setDeleteAssetId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </MainLayout>
    </>
  );
}
