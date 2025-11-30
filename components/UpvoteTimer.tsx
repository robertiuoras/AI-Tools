"use client";

import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function UpvoteTimer() {
  const [timeUntilReset, setTimeUntilReset] = useState<string>("");
  const [daysUntilMonthlyReset, setDaysUntilMonthlyReset] = useState<number>(0);

  useEffect(() => {
    const updateTimers = () => {
      const now = new Date();

      // Calculate time until midnight (daily reset)
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      const hours = Math.floor(msUntilMidnight / (1000 * 60 * 60));
      const minutes = Math.floor(
        (msUntilMidnight % (1000 * 60 * 60)) / (1000 * 60)
      );
      const seconds = Math.floor((msUntilMidnight % (1000 * 60)) / 1000);

      setTimeUntilReset(`${hours}h ${minutes}m ${seconds}s`);

      // Calculate days until monthly reset (first day of next month)
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const msUntilNextMonth = nextMonth.getTime() - now.getTime();
      const days = Math.ceil(msUntilNextMonth / (1000 * 60 * 60 * 24));
      setDaysUntilMonthlyReset(days);
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Upvotes
              </span>
              <span className="text-muted-foreground">
                Daily reset:{" "}
                <span className="font-medium text-foreground">
                  {timeUntilReset}
                </span>
              </span>
            </div>
            <span className="text-muted-foreground">
              Monthly reset:{" "}
              <span className="font-medium text-foreground">
                {daysUntilMonthlyReset} day
                {daysUntilMonthlyReset !== 1 ? "s" : ""}
              </span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
