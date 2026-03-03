"use client";

import { useState } from "react";

interface CreatorAvatarProps {
  name: string;
  src: string | null;
  size?: "sm" | "md";
  className?: string;
}

export function CreatorAvatar({ name, src, size = "sm", className = "" }: CreatorAvatarProps) {
  const [error, setError] = useState(false);
  const sizeClass = size === "sm" ? "h-10 w-10" : "h-14 w-14";
  const textClass = size === "sm" ? "text-lg" : "text-2xl";

  return (
    <div
      className={`${sizeClass} flex-shrink-0 flex items-center justify-center rounded-full overflow-hidden bg-gradient-to-br from-rose-500/20 to-orange-500/20 font-bold text-rose-600 dark:text-rose-400 ${textClass} ${className}`}
    >
      {src && !error ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setError(true)}
        />
      ) : (
        name.charAt(0).toUpperCase() || "?"
      )}
    </div>
  );
}
