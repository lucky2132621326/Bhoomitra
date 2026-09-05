"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import LanguageSelector from "@/components/language-selector"
import { useLanguage, isLanguage, type Language } from "@/lib/language-context"
import {
  UserCircle,
  Crown,
  Shield,
  Wrench,
  Eye,
  Mail,
  Phone,
  MapPin,
  CalendarDays,
  Clock,
  Languages,
  Lock,
  LogOut,
  Loader2,
  Save,
} from "lucide-react"

interface Account {
  id: string
  name: string
  email: string | null
  phone: string | null
  location: string | null
  role: string
  status: string
  authMethod: string
  createdAt: string | null
  lastLogin: string | null
  isGuest: boolean
  language?: string | null
}

const roleMeta: Record<string, { icon: any; label: string; className: string }> = {
  admin: { icon: Crown, label: "Administrator", className: "bg-red-50 text-red-700 border-red-200" },
  manager: { icon: Shield, label: "Manager", className: "bg-blue-50 text-blue-700 border-blue-200" },
  operator: { icon: Wrench, label: "Operator", className: "bg-green-50 text-green-700 border-green-200" },
  viewer: { icon: Eye, label: "Viewer", className: "bg-slate-100 text-slate-700 border-slate-200" },
}

function formatDate(value: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export default function AccountPage() {
  const router = useRouter()
  const { setLanguage } = useLanguage()
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const [form, setForm] = useState({ name: "", location: "", email: "" })
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" })

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.success) {
          router.replace("/login")
          return
        }
        const u: Account = data.user
        setAccount(u)
        setForm({ name: u.name || "", location: u.location || "", email: u.email || "" })
        if (isLanguage(u.language)) {
          setLanguage(u.language)
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveProfile = async () => {
    if (!account) return
    setSavingProfile(true)
    try {
      const res = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setAccount({ ...account, ...data.user })
        toast.success("Profile updated")
      } else {
        toast.error(data.message || "Could not update profile")
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async () => {
    if (pw.next !== pw.confirm) {
      toast.error("New passwords do not match")
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success("Password updated")
        setPw({ current: "", next: "", confirm: "" })
      } else {
        toast.error(data.message || "Could not update password")
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSavingPassword(false)
    }
  }

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      toast.success("Logged out")
      router.push("/login")
      router.refresh()
    } catch {
      toast.error("Logout failed")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-[#3a7d44]" />
        <p className="animate-pulse text-muted-foreground">Loading your account…</p>
      </div>
    )
  }

  if (!account) return null

  const initials = account.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
  const rMeta = roleMeta[account.role] || roleMeta.viewer
  const RoleIcon = rMeta.icon
  const hasPassword = account.authMethod === "email" || account.authMethod === "password" || Boolean(account.email)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-black text-[#1a2e1d]">
          <UserCircle className="h-8 w-8 text-green-600" />
          My Account
        </h1>
        <p className="text-muted-foreground">Manage your profile, language, and security.</p>
      </div>

      {account.isGuest && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 text-sm font-medium text-amber-900">
            You’re browsing as a guest. Sign in with your phone or email to save a profile.
          </CardContent>
        </Card>
      )}

      {/* Identity summary */}
      <Card className="border-green-100 shadow-lg">
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
          <Avatar className="h-20 w-20 border-4 border-green-50 text-2xl">
            <AvatarFallback className="bg-green-100 text-green-700 font-bold">{initials || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-800">{account.name}</h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold ${rMeta.className}`}>
                <RoleIcon className="h-3.5 w-3.5" /> {rMeta.label}
              </span>
              <Badge variant="outline" className="border-green-200 text-green-700 capitalize">
                {account.status}
              </Badge>
            </div>
            <div className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
              {account.email && <span className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{account.email}</span>}
              {account.phone && <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{account.phone}</span>}
              <span className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" />Joined {formatDate(account.createdAt)}</span>
              <span className="flex items-center gap-2"><Clock className="h-3.5 w-3.5" />Last login {formatDate(account.lastLogin)}</span>
            </div>
          </div>
          <Button variant="outline" onClick={logout} className="gap-2 border-red-200 text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Profile edit */}
        <Card className="border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Profile details</CardTitle>
            <CardDescription>Update your personal information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={form.name} disabled={account.isGuest}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location" className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Location / Village</Label>
              <Input id="location" value={form.location} disabled={account.isGuest}
                placeholder="e.g. Warangal, Telangana"
                onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Email</Label>
              <Input id="email" type="email" value={form.email}
                disabled={account.isGuest || Boolean(account.email)}
                placeholder="Add an email (optional)"
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {Boolean(account.email) && (
                <p className="text-xs text-muted-foreground">Email can’t be changed once set. Contact an admin if needed.</p>
              )}
            </div>
            <Button onClick={saveProfile} disabled={account.isGuest || savingProfile} className="gap-2 bg-green-600 hover:bg-green-700">
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-8">
          {/* Language */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Languages className="h-5 w-5 text-green-600" /> Language</CardTitle>
              <CardDescription>Choose the language for your dashboard.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">Applies instantly across the app.</p>
              <LanguageSelector
                align="right"
                onChange={(lang) => {
                  if (account.isGuest) return
                  fetch("/api/account", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ language: lang }),
                  }).catch(() => {})
                }}
              />
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-5 w-5 text-green-600" /> Password</CardTitle>
              <CardDescription>
                {hasPassword ? "Change your account password." : "This account signs in with a phone OTP — no password needed."}
              </CardDescription>
            </CardHeader>
            {hasPassword && (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cur-pw">Current password</Label>
                  <Input id="cur-pw" type="password" value={pw.current}
                    onChange={(e) => setPw({ ...pw, current: e.target.value })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-pw">New password</Label>
                    <Input id="new-pw" type="password" value={pw.next}
                      onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="conf-pw">Confirm</Label>
                    <Input id="conf-pw" type="password" value={pw.confirm}
                      onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
                  </div>
                </div>
                <Button variant="outline" onClick={changePassword}
                  disabled={savingPassword || !pw.current || !pw.next}
                  className="gap-2">
                  {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Update password
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
