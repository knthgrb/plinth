import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class FilesService {
  static async getFileUrl(storageId: string): Promise<string> {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).files.getFileUrl, {
      storageId: storageId as Id<"_storage">,
    });
  }

  static async generateUploadUrl(): Promise<string> {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).files.generateUploadUrl);
  }
}
