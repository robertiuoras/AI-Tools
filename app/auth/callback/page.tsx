"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Check if we have a code in the URL (PKCE flow)
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");

        if (code) {
          // Exchange code for session
          const { data, error } = await supabase.auth.exchangeCodeForSession(
            code
          );

          if (error) {
            console.error("Error exchanging code:", error);
            router.push(`/?error=${encodeURIComponent(error.message)}`);
            return;
          }

          if (data.user) {
            // Create user record if it doesn't exist
            const { data: existingUser } = await supabase
              .from("user")
              .select("id")
              .eq("id", data.user.id)
              .single();

            if (!existingUser) {
              const { error: insertError } = await supabase
                .from("user")
                .insert([
                  {
                    id: data.user.id,
                    email: data.user.email!,
                    name:
                      data.user.user_metadata?.name ||
                      data.user.user_metadata?.full_name ||
                      data.user.user_metadata?.display_name ||
                      data.user.email?.split("@")[0] ||
                      "User",
                    role: "user",
                  },
                ]);

              if (insertError) {
                console.error("Error creating user:", insertError);
              }
            }
          }

          // Redirect to home
          router.push("/");
          return;
        }

        // Check if we have tokens in the hash (implicit flow - what's happening)
        if (typeof window !== "undefined" && window.location.hash) {
          const hashParams = new URLSearchParams(
            window.location.hash.substring(1)
          );
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken && refreshToken) {
            console.log("Found tokens in hash, setting session...");

            // Set the session manually
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (error) {
              console.error("Error setting session:", error);
              router.push(`/?error=${encodeURIComponent(error.message)}`);
              return;
            }

            console.log("Session set successfully, user:", data.user?.email);

            if (data.user) {
              // Create user record if it doesn't exist
              const { data: existingUser } = await supabase
                .from("user")
                .select("id")
                .eq("id", data.user.id)
                .single();

              if (!existingUser) {
                const { error: insertError } = await supabase
                  .from("user")
                  .insert([
                    {
                      id: data.user.id,
                      email: data.user.email!,
                      name:
                        data.user.user_metadata?.name ||
                        data.user.user_metadata?.full_name ||
                        data.user.user_metadata?.display_name ||
                        data.user.email?.split("@")[0] ||
                        "User",
                      role: "user",
                    },
                  ]);

                if (insertError) {
                  console.error("Error creating user:", insertError);
                  // Try to get more details about the error
                  if (insertError.code === "23505") {
                    console.log("User already exists (duplicate key)");
                  } else {
                    console.error(
                      "Insert error details:",
                      JSON.stringify(insertError, null, 2)
                    );
                  }
                } else {
                  console.log("User created successfully:", data.user.id);
                }
              } else {
                console.log("User already exists:", existingUser.id);
              }
            }

            // Clear the hash and redirect
            window.history.replaceState({}, "", "/");
            // Force a reload to update auth state
            window.location.href = "/";
            return;
          }
        }

        // No code or tokens found, redirect to home
        console.log("No auth tokens found, redirecting to home");
        router.push("/");
      } catch (error: any) {
        console.error("Error in auth callback:", error);
        router.push(
          `/?error=${encodeURIComponent(
            error.message || "Authentication failed"
          )}`
        );
      }
    };

    // Small delay to ensure page is fully loaded
    const timer = setTimeout(() => {
      handleAuthCallback();
    }, 100);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
