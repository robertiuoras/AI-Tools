"use client"

import * as React from "react"
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ToastProps {
  id: string
  title?: string
  description?: string
  variant?: "default" | "success" | "error" | "warning" | "info"
  duration?: number
  onClose?: () => void
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ id, title, description, variant = "default", duration = 5000, onClose }, ref) => {
    const [isVisible, setIsVisible] = React.useState(true)

    React.useEffect(() => {
      if (duration > 0) {
        const timer = setTimeout(() => {
          setIsVisible(false)
          setTimeout(() => onClose?.(), 300) // Wait for animation
        }, duration)
        return () => clearTimeout(timer)
      }
    }, [duration, onClose])

    const handleClose = () => {
      setIsVisible(false)
      setTimeout(() => onClose?.(), 300)
    }

    const variants = {
      default: "bg-background border-border",
      success: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
      error: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
      warning: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800",
      info: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
    }

    const icons = {
      default: Info,
      success: CheckCircle2,
      error: AlertCircle,
      warning: AlertTriangle,
      info: Info,
    }

    const iconColors = {
      default: "text-foreground",
      success: "text-green-600 dark:text-green-400",
      error: "text-red-600 dark:text-red-400",
      warning: "text-yellow-600 dark:text-yellow-400",
      info: "text-blue-600 dark:text-blue-400",
    }

    const textColors = {
      default: "text-foreground",
      success: "text-green-900 dark:text-green-100",
      error: "text-red-900 dark:text-red-100",
      warning: "text-yellow-900 dark:text-yellow-100",
      info: "text-blue-900 dark:text-blue-100",
    }

    const Icon = icons[variant]

    if (!isVisible) return null

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg transition-all",
          variants[variant],
          isVisible ? "animate-in slide-in-from-top-5" : "animate-out slide-out-to-top-5"
        )}
      >
        <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", iconColors[variant])} />
        <div className="flex-1 space-y-1">
          {title && (
            <div className={cn("text-sm font-semibold", textColors[variant])}>
              {title}
            </div>
          )}
          {description && (
            <div className={cn("text-sm", textColors[variant], title && "opacity-90")}>
              {description}
            </div>
          )}
        </div>
        <button
          onClick={handleClose}
          className={cn(
            "absolute right-2 top-2 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
            textColors[variant]
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }
)
Toast.displayName = "Toast"

export { Toast }

