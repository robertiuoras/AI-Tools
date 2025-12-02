import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Helper to get authenticated user
function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

export async function POST(request: NextRequest) {
  try {
    // Check if user is admin
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");
    
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }
    
    if (!userId) {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const admin = supabaseAdmin as any;
    const { data: userData, error: userError } = await admin
      .from("user")
      .select("role")
      .eq("id", userId)
      .single();

    if (userError || !userData || userData.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get all tools without ratings
    const { data: toolsWithoutRatings, error: toolsError } = await admin
      .from("tool")
      .select("id, name, url, description")
      .is("rating", null)
      .limit(50); // Process 50 at a time to avoid rate limits

    if (toolsError) {
      console.error("Error fetching tools:", toolsError);
      return NextResponse.json(
        { error: "Failed to fetch tools" },
        { status: 500 }
      );
    }

    if (!toolsWithoutRatings || toolsWithoutRatings.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No tools without ratings found",
        processed: 0,
      });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each tool
    for (const tool of toolsWithoutRatings) {
      try {
        // Create a simple prompt for rating estimation
        const prompt = `Analyze this AI tool and estimate a rating (0-5) based on the information provided. Return ONLY a JSON object with a "rating" field (number between 0 and 5, or null if cannot determine).

Tool Name: ${tool.name}
URL: ${tool.url}
Description: ${tool.description || "N/A"}

Consider:
- Quality indicators in the description
- Popularity signals
- Professional appearance
- User testimonials or reviews mentioned
- Overall impression

Return JSON only:
{
  "rating": 4.5
}`;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You are a tool that estimates ratings for AI tools. Return valid JSON only.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            response_format: { type: "json_object" },
            max_tokens: 100,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Error for tool ${tool.id}:`, errorText);
          results.push({ toolId: tool.id, toolName: tool.name, error: errorText });
          errorCount++;
          continue;
        }

        const data = await response.json();
        const content = JSON.parse(data.choices[0].message.content);
        const rating = content.rating;

        if (rating !== null && rating !== undefined && typeof rating === "number" && rating >= 0 && rating <= 5) {
          // Update tool with rating
          const { error: updateError } = await admin
            .from("tool")
            .update({ rating: rating })
            .eq("id", tool.id);

          if (updateError) {
            console.error(`Error updating tool ${tool.id}:`, updateError);
            results.push({ toolId: tool.id, toolName: tool.name, error: updateError.message });
            errorCount++;
          } else {
            results.push({ toolId: tool.id, toolName: tool.name, rating: rating, success: true });
            successCount++;
          }
        } else {
          results.push({ toolId: tool.id, toolName: tool.name, error: "Invalid rating format" });
          errorCount++;
        }

        // Small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error(`Error processing tool ${tool.id}:`, error);
        results.push({ toolId: tool.id, toolName: tool.name, error: error.message });
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${toolsWithoutRatings.length} tools`,
      processed: toolsWithoutRatings.length,
      successCount,
      errorCount,
      results,
    });
  } catch (error: any) {
    console.error("Error in add-missing-ratings:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

