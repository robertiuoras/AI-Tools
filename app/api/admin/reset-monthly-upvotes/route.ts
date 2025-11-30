import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Mark this route as dynamic
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // This endpoint should be protected - only admins can call it
    // For now, we'll allow it but you should add proper auth checks

    const admin = supabaseAdmin as any;

    // Get first day of current month
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    // Delete all upvotes from previous months
    const { error: deleteError } = await admin
      .from("upvote")
      .delete()
      .lt("monthlyResetDate", currentMonthStart);

    if (deleteError) {
      console.error("Error resetting monthly upvotes:", deleteError);
      return NextResponse.json(
        { error: "Failed to reset monthly upvotes" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Monthly upvotes reset successfully",
      deletedCount: "See Supabase logs for count",
    });
  } catch (error: any) {
    console.error("Error in reset-monthly-upvotes:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
