'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthSession } from '@/components/AuthSessionProvider'
import {
  useUserProfile,
  userInitials,
  avatarColor,
} from '@/components/UserProfileProvider'
import { ProfileSettingsDialog } from '@/components/ProfileSettingsDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2,
  LogIn,
  LogOut,
  User,
  Mail,
  Settings as SettingsIcon,
  ChevronDown,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export function AuthButton() {
  const { user, isReady } = useAuthSession()
  const loading = !isReady
  const [showLogin, setShowLogin] = useState(false)
  const [showSignUp, setShowSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setAuthLoading(true)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name || email.split('@')[0],
          },
        },
      })

      if (signUpError) throw signUpError

      if (data.user) {
        alert('Sign up successful! Please check your email to verify your account.')
        setShowSignUp(false)
        setEmail('')
        setPassword('')
        setName('')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign up')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setAuthLoading(true)

    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (loginError) throw loginError

      setShowLogin(false)
      setEmail('')
      setPassword('')
    } catch (err: any) {
      setError(err.message || 'Failed to log in')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setAuthLoading(true)

    try {
      const { data, error: googleError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: false, // Let Supabase handle the redirect
        },
      })

      if (googleError) {
        throw googleError
      }

      // OAuth will redirect automatically - don't set loading to false here
      // The redirect will happen automatically
    } catch (err: any) {
      setError(err.message || 'Failed to sign in with Google')
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    )
  }

  if (user) {
    return <UserMenu onLogout={handleLogout} />
  }

  return (
    <div className="flex items-center gap-2">
      <Dialog open={showLogin} onOpenChange={setShowLogin}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <LogIn className="h-4 w-4 mr-2" />
            Login
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Login</DialogTitle>
            <DialogDescription>
              Sign in to upvote tools and share your feedback
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={authLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={authLoading}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={authLoading}>
              {authLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                'Login'
              )}
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={authLoading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showSignUp} onOpenChange={setShowSignUp}>
        <DialogTrigger asChild>
          <Button size="sm">
            <User className="h-4 w-4 mr-2" />
            Sign Up
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign Up</DialogTitle>
            <DialogDescription>
              Create an account to upvote tools and share your feedback
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-name">Name (optional)</Label>
              <Input
                id="signup-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={authLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={authLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={authLoading}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={authLoading}>
              {authLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing up...
                </>
              ) : (
                'Sign Up'
              )}
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={authLoading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Header user pill: avatar (or initials) + dropdown with settings + logout.
 * Replaces the old "raw email + Logout button" so the header looks polished
 * and editable. Updates the moment the profile changes (broadcast event).
 */
function UserMenu({ onLogout }: { onLogout: () => Promise<void> }) {
  const { user } = useAuthSession()
  const { profile } = useUserProfile()
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Click-away + Esc close.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const displayName =
    profile?.name?.trim() ||
    (user?.user_metadata as Record<string, string> | undefined)?.name?.trim() ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = userInitials(profile?.name, profile?.email ?? user?.email)
  const bgColor = avatarColor(profile?.id ?? user?.id ?? user?.email)
  const avatarUrl = profile?.avatar_url ?? null

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((s) => !s)}
          title={displayName}
          className={cn(
            'group flex items-center gap-2 rounded-full border border-border/60 bg-background/60 py-1 pl-1 pr-2 text-sm font-medium text-foreground transition-colors hover:bg-muted',
            open && 'bg-muted ring-1 ring-primary/30',
          )}
        >
          <span
            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: bgColor }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span aria-hidden>{initials}</span>
            )}
          </span>
          <span className="hidden max-w-[140px] truncate text-xs sm:inline">
            {displayName}
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-[140] mt-1.5 w-56 overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-1 shadow-2xl ring-1 ring-black/5 backdrop-blur"
          >
            <div className="border-b border-border/60 px-3 py-2">
              <p className="truncate text-xs font-semibold text-foreground">
                {displayName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {profile?.email ?? user?.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setSettingsOpen(true)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-muted"
            >
              <SettingsIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Profile settings
            </button>
            <div className="my-1 h-px bg-border/60" role="separator" />
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void onLogout()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-muted"
            >
              <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
      <ProfileSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )
}

