import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { UserService } from "@/services/user-service";

export async function GET(request: NextRequest) {
  try {
    const result = await UserService.getUserRoleAndOrg();

    if (!result.role || !result.organizationId) {
      return NextResponse.json(
        { role: null, error: "No organizations or user not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      role: result.role,
      organizationId: result.organizationId,
    });
  } catch (error: any) {
    console.error("Error getting user role:", error);
    return NextResponse.json(
      { role: null, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
