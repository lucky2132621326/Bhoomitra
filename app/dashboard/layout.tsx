"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "@/lib/use-translation"
import { useNavigation } from "@/lib/navigation-context"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import LanguageSelector from "@/components/language-selector"
import {
    Home,
    SprayCan,
    Map,
    Microscope,
    BarChart3,
    Brain,
    Users,
    Info,
    History,
    LogOut,
    UserCircle,
    Radar,
    PanelLeftClose,
    PanelLeftOpen,
    Bug,
    Menu,
} from "lucide-react"

type NavItem = {
    name: string
    href: string
    icon: any
    adminOnly?: boolean
}

type NavGroup = {
    label: string
    items: NavItem[]
}

const SIDEBAR_NAV_ID = "dashboard-sidebar-nav"
const MOBILE_NAV_ID = "dashboard-mobile-nav"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const router = useRouter()
    const t = useTranslation()
    const { setIsLoading } = useNavigation()
    const [role, setRole] = useState<string | null>(null)
    const [checked, setChecked] = useState(false)
    // Explicit, click-driven expand/collapse — no hover-triggered state.
    const [collapsed, setCollapsed] = useState(false)
    const expanded = !collapsed
    // Mobile drawer (below 768px only). Radix Sheet handles Escape, backdrop
    // dismissal, focus trapping/restore and background scroll locking.
    const [mobileNavOpen, setMobileNavOpen] = useState(false)

    // Resolve the live account (role + block status). If the account was
    // blocked/removed while the session was open, bounce back to login.
    useEffect(() => {
        let active = true
        fetch("/api/auth/me")
            .then(async (res) => {
                const data = await res.json().catch(() => ({}))
                if (!active) return
                if (!res.ok || !data?.success) {
                    if (data?.blocked) {
                        toast.error(data.message || t("nav.accessRevoked"))
                    }
                    router.replace("/login")
                    return
                }
                setRole(data.user?.role ?? null)
                setChecked(true)
            })
            .catch(() => {
                if (active) setChecked(true)
            })
        return () => {
            active = false
        }
    }, [router])

    const navGroups: NavGroup[] = [
        {
            label: t("nav.group.overview"),
            items: [
                { name: t("nav.dashboard"), href: "/dashboard", icon: Home },
            ],
        },
        {
            label: t("nav.group.fieldOperations"),
            items: [
                { name: t("nav.detection"), href: "/dashboard/detection", icon: Microscope },
                { name: t("nav.autospray"), href: "/dashboard/autospray", icon: SprayCan },
                { name: t("nav.map"), href: "/dashboard/map", icon: Map },
                { name: t("nav.pests"), href: "/dashboard/pests", icon: Bug },
                { name: t("nav.spreadControl"), href: "/dashboard/spread-control", icon: Radar },
            ],
        },
        {
            label: t("nav.group.insights"),
            items: [
                { name: t("nav.analytics"), href: "/dashboard/analytics", icon: BarChart3 },
                { name: t("nav.recommendations"), href: "/dashboard/recommendations", icon: Brain },
                { name: t("nav.activity"), href: "/dashboard/history", icon: History },
            ],
        },
        {
            label: t("nav.group.account"),
            items: [
                { name: t("nav.users"), href: "/dashboard/users", icon: Users, adminOnly: true },
                { name: t("nav.about"), href: "/dashboard/about", icon: Info },
                { name: t("nav.account"), href: "/dashboard/account", icon: UserCircle },
            ],
        },
    ]

    const visibleGroups = navGroups
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => !item.adminOnly || role === "admin"),
        }))
        .filter((group) => group.items.length > 0)

    useEffect(() => {
        navGroups.forEach((group) => group.items.forEach((item) => router.prefetch(item.href)))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, role])

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" })
            toast.success(t("nav.logoutSuccess"))
            router.push("/login")
            router.refresh()
        } catch (error) {
            toast.error(t("nav.logoutFailed"))
        }
    }

    return (
        <div className="flex min-h-screen bg-gradient-to-br from-[#f4fbf6] via-[#eef9f2] to-[#e6f6ec]">

            {/* ===== MOBILE HEADER + DRAWER (below 768px only) ===== */}
            <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-emerald-100/80 bg-white/95 px-3 backdrop-blur md:hidden">
                <button
                    type="button"
                    onClick={() => setMobileNavOpen(true)}
                    aria-label={t("nav.openMenu")}
                    aria-haspopup="dialog"
                    aria-expanded={mobileNavOpen}
                    aria-controls={MOBILE_NAV_ID}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#2c4633] transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong/60"
                >
                    <Menu size={22} />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-strong text-[11px] font-black text-white">
                        BT
                    </div>
                    <span className="truncate text-base font-black tracking-tight text-[#14231a]">Bhoomitra</span>
                </div>
                <LanguageSelector align="right" />
            </header>

            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetContent
                    id={MOBILE_NAV_ID}
                    side="left"
                    className="w-[85vw] max-w-[20rem] gap-0 bg-white p-0 pb-[env(safe-area-inset-bottom)] md:hidden"
                >
                    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-emerald-50 px-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-strong text-[11px] font-black text-white">
                            BT
                        </div>
                        <SheetTitle className="text-base font-black tracking-tight text-[#14231a]">Bhoomitra</SheetTitle>
                    </div>

                    <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label={t("nav.menuTitle")}>
                        {visibleGroups.map((group, groupIndex) => (
                            <div key={group.label} className={groupIndex > 0 ? "mt-5" : ""}>
                                <p className="px-3.5 pb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#8aa696]">{group.label}</p>
                                <div className="space-y-1.5">
                                    {group.items.map((item) => {
                                        const Icon = item.icon
                                        const isActive = pathname === item.href
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                prefetch
                                                onClick={() => {
                                                    if (pathname !== item.href) setIsLoading(true)
                                                    setMobileNavOpen(false)
                                                }}
                                                className={`flex min-h-[44px] items-center gap-4 rounded-2xl px-3.5 py-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong/60 ${isActive
                                                    ? "bg-brand-strong text-white"
                                                    : "text-[#2c4633] hover:bg-emerald-50"
                                                    }`}
                                            >
                                                <Icon size={22} className="shrink-0" />
                                                <span className="font-bold">{item.name}</span>
                                            </Link>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </nav>

                    <div className="shrink-0 border-t border-emerald-50 px-3 py-3">
                        <button
                            onClick={() => {
                                setMobileNavOpen(false)
                                handleLogout()
                            }}
                            className="flex min-h-[44px] w-full items-center gap-4 rounded-2xl px-3.5 py-3 text-base font-bold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        >
                            <LogOut size={22} className="shrink-0" />
                            <span>{t("nav.logout")}</span>
                        </button>
                    </div>
                </SheetContent>
            </Sheet>

            {/* ===== SIDEBAR ===== */}
            <aside
                className={`fixed left-0 top-0 z-50 hidden h-screen flex-col overflow-hidden md:flex border-r border-emerald-100/80 bg-white/95 shadow-[8px_0_40px_-24px_rgba(16,185,129,0.5)] backdrop-blur transition-[width] duration-300 ease-out ${expanded ? "w-72" : "w-20"}`}
            >
                {/* Brand + explicit collapse control */}
                <div className="flex h-20 shrink-0 items-center gap-2 px-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-strong text-sm font-black text-white shadow-[0_0_20px_-4px_rgba(16,185,129,0.6)]">
                        BT
                    </div>
                    <span className={`flex-1 text-xl font-black tracking-tight text-[#14231a] transition-all duration-300 ${expanded ? "max-w-[140px] opacity-100" : "max-w-0 opacity-0"} overflow-hidden whitespace-nowrap`}>Bhoomitra</span>
                </div>

                {/* Single, always-mounted toggle button — keeps keyboard focus
                    across the collapse/expand transition instead of the focus
                    being dropped when the control's DOM position would
                    otherwise change. */}
                <div className={`flex shrink-0 px-3 pb-3 ${expanded ? "justify-end" : "justify-center"}`}>
                    <button
                        type="button"
                        onClick={() => setCollapsed((value) => !value)}
                        aria-expanded={expanded}
                        aria-controls={SIDEBAR_NAV_ID}
                        aria-label={expanded ? t("nav.collapseSidebar") : t("nav.expandSidebar")}
                        title={expanded ? t("nav.collapseSidebar") : t("nav.expandSidebar")}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#2c4633] transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong/60"
                    >
                        {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                    </button>
                </div>

                {/* Nav */}
                <nav id={SIDEBAR_NAV_ID} className="scrollbar-thin scrollbar-thumb-emerald-100 min-h-0 w-full flex-1 overflow-y-auto px-3 py-2">
                    {visibleGroups.map((group, groupIndex) => (
                        <div key={group.label} className={groupIndex > 0 ? "mt-5" : ""}>
                            {expanded ? (
                                <p className="px-3.5 pb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#8aa696]">{group.label}</p>
                            ) : groupIndex > 0 ? (
                                <div className="mx-4 mb-2 border-t border-emerald-50" />
                            ) : null}
                            <div className="space-y-1.5">
                                {group.items.map((item) => {
                                    const Icon = item.icon
                                    const isActive = pathname === item.href
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            prefetch
                                            title={!expanded ? item.name : undefined}
                                            onMouseEnter={() => router.prefetch(item.href)}
                                            onClick={() => { if (pathname !== item.href) setIsLoading(true) }}
                                            className={`group/nav relative flex items-center gap-4 rounded-2xl px-3.5 py-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong/60 ${isActive
                                                ? "bg-brand-strong text-white shadow-[0_0_22px_-6px_rgba(16,185,129,0.7)]"
                                                : "text-[#2c4633] hover:bg-emerald-50"
                                                }`}
                                        >
                                            {isActive && !expanded && <span className="absolute right-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white" />}
                                            <Icon size={22} className="shrink-0" />
                                            <span className={`text-sm font-bold whitespace-nowrap transition-all duration-300 ${expanded ? "max-w-[180px] opacity-100" : "max-w-0 opacity-0"} overflow-hidden`}>{item.name}</span>
                                        </Link>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Logout */}
                <div className="shrink-0 border-t border-emerald-50 px-3 py-4">
                    <button
                        onClick={handleLogout}
                        title={!expanded ? t("nav.logout") : undefined}
                        className="flex w-full items-center gap-4 rounded-2xl px-3.5 py-3 text-red-600 transition-all duration-200 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                        <LogOut size={22} className="shrink-0" />
                        <span className={`text-sm font-bold whitespace-nowrap transition-all duration-300 ${expanded ? "max-w-[180px] opacity-100" : "max-w-0 opacity-0"} overflow-hidden`}>{t("nav.logout")}</span>
                    </button>
                </div>
            </aside>

            {/* ===== MAIN CONTENT =====
                Margin tracks the sidebar's actual current width so content is
                never covered, whether the sidebar is collapsed or expanded. */}
            <main className={`min-h-screen min-w-0 flex-1 pt-14 transition-[margin-left] duration-300 ease-out md:pt-0 ${expanded ? "md:ml-72" : "md:ml-20"}`}>
                <div className="hidden justify-end border-b border-emerald-100/80 bg-white/80 px-6 py-3 md:flex">
                    <LanguageSelector align="right" />
                </div>
                <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 xl:px-10 xl:py-10">
                    {children}
                </div>
            </main>

        </div>
    )
}
