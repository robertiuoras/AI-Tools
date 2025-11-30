"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Shield, CheckCircle2, XCircle } from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export default function SetAdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push("/");
        return;
      }

      setUser(session.user);

      // Get current role
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (currentSession) {
        const response = await fetch("/api/auth/check", {
          headers: {
            Authorization: `Bearer ${currentSession.access_token}`,
          },
        });
        const data = await response.json();
        setCurrentRole(data.role || "user");
      }

      setLoading(false);
    };

    checkAuth();
  }, [router]);

  const handleSetAdmin = async () => {
    if (!user) return;

    setProcessing(true);
    setMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("No session found");
      }

      const response = await fetch("/api/admin/set-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: user.id,
          role: "admin",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to set admin role");
      }

      setMessage({ type: "success", text: "Admin role set successfully! You can now access the admin page." });
      setCurrentRole("admin");
      
      // Redirect to admin page after 2 seconds
      setTimeout(() => {
        router.push("/admin");
      }, 2000);
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed to set admin role" });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Set Admin Role
          </CardTitle>
          <CardDescription>
            Promote yourself to admin to access the admin dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <strong>Email:</strong> {user.email}
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Current Role:</strong>{" "}
              <span className="font-medium">{currentRole || "user"}</span>
            </p>
          </div>

          {currentRole === "admin" ? (
            <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              <p className="text-sm text-green-700 dark:text-green-300">
                You already have admin role! You can access the admin page.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Click the button below to set your role to admin. This will allow you to:
              </p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>Access the admin dashboard</li>
                <li>Add, edit, and delete tools</li>
                <li>Manage user roles</li>
              </ul>

              <Button
                onClick={handleSetAdmin}
                disabled={processing}
                className="w-full"
              >
                {processing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting admin role...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Set Admin Role
                  </>
                )}
              </Button>
            </div>
          )}

          {message && (
            <div
              className={`flex items-center gap-2 p-4 rounded-lg ${
                message.type === "success"
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          <div className="pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="w-full"
            >
              Back to Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

