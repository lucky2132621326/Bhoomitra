"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Brain,
  Sprout,
  History,
  Shield,
  ArrowRight,
  CheckCircle,
  Cpu,
  Layers,
  FlaskConical,
  BarChart3,
  X,
} from "lucide-react"
import FarmerOnboarding from "@/components/farmer-onboarding"

// ── tiny helpers ──────────────────────────────────────────────────────────────
function StatusPill({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur border border-white/20 text-sm font-medium text-white">
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <span className="text-white/60">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
  accent,
  delay,
  onOpen,
}: {
  icon: any
  title: string
  description: string
  href: string
  accent: string
  delay: string
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <a
      href={href}
      onClick={onOpen}
      className="group relative flex flex-col gap-4 p-6 rounded-2xl border border-[#d4e9c8] bg-white shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden animate-fade-in-up"
      style={{ animationDelay: delay }}
    >
      {/* subtle corner accent */}
      <div
        className={`absolute -top-8 -right-8 w-28 h-28 rounded-full blur-2xl opacity-30 group-hover:opacity-60 transition-opacity duration-300 ${accent}`}
      />

      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${accent} bg-opacity-15`}>
        <Icon className="h-5 w-5 text-[#3a7d44]" />
      </div>

      <div className="space-y-1.5">
        <h3 className="font-semibold text-[#1e3a23] text-lg leading-tight">{title}</h3>
        <p className="text-sm text-[#5a7a60] leading-relaxed">{description}</p>
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-sm font-semibold text-[#3a7d44] group-hover:gap-2.5 transition-all duration-200">
        Open <ArrowRight className="h-4 w-4" />
      </div>
    </a>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter()
  const [showSplash, setShowSplash] = useState(true)
  const [isOnboardingRequired, setIsOnboardingRequired] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [launchingDashboard, setLaunchingDashboard] = useState(false)
  const [splashLogoSrc, setSplashLogoSrc] = useState("/Bhoomitra-removebg-preview.png")

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const checkProfile = async () => {
      try {
        const res = await fetch("/api/farmer-profile")
        const data = await res.json()
        setIsOnboardingRequired(!data?.exists)
      } catch (error) {
        setIsOnboardingRequired(true)
      } finally {
        setLoadingProfile(false)
      }
    }

    checkProfile()
  }, [])

  if (loadingProfile || showSplash) {
    return (
      <div className="min-h-screen grid place-items-center startup-screen text-[#1e3a23]">
        <div className="flex flex-col items-center gap-4 px-6">
          <img
            src={splashLogoSrc}
            alt="Bhoomitra logo"
            className="startup-logo"
            onError={() => setSplashLogoSrc("/bhoomitra-logo.svg")}
          />
          <p className="text-sm font-medium startup-loader-text">Loading Bhoomitra profile...</p>
        </div>
      </div>
    )
  }

  if (isOnboardingRequired) {
    return <FarmerOnboarding onComplete={() => setIsOnboardingRequired(false)} />
  }

  const features = [
    {
      icon: Brain,
      title: "Disease Detection",
      description:
        "Upload crop images and get instant AI diagnosis with severity scoring and confidence metrics powered by a registry-backed model stack.",
      href: "/dashboard/detection",
      accent: "bg-emerald-100",
    },
    {
      icon: Sprout,
      title: "Spray Optimization",
      description:
        "Logarithmic penalty engine computes required vs. actual spray volumes, preventing overspray and waste.",
      href: "/dashboard/autospray",
      accent: "bg-lime-100",
    },
    {
      icon: BarChart3,
      title: "Farm Health Analytics",
      description:
        "Track field health, weather-driven disease pressure, water saved, and projected yield protected — every number real or a labelled projection.",
      href: "/dashboard/analytics",
      accent: "bg-green-100",
    },
    {
      icon: Layers,
      title: "View Farm Map",
      description:
        "Visualize zone health, active detections and sprayinterventions in real time.",
      href: "/dashboard/map",
      accent: "bg-cyan-100",
    },
    {
      icon: History,
      title: "AI Recommendations",
      description:
        "Audit every detection event and intervention. Full timeline with disease class, severity, and response logs.",
      href: "/dashboard/recommendations",
      accent: "bg-cyan-100",
    },
  ]

  const comparison = [
    { label: "Disease Identification", traditional: "Visual scouting (days)", ai: "AI detection in seconds" },
    { label: "Spray Decision", traditional: "Calendar-based guessing", ai: "Severity-weighted optimization" },
    { label: "Risk Modeling", traditional: "No quantification", ai: "Logarithmic risk engine" },
    { label: "Water Usage", traditional: "Fixed blanket spraying", ai: "Zone-level precision dosing" },
    { label: "Intervention Timing", traditional: "Reactive, after visible damage", ai: "Predictive, pre-threshold alerts" },
  ]

  const handleLaunchDashboard = async () => {
    if (launchingDashboard) {
      return
    }

    setLaunchingDashboard(true)
    try {
      const response = await fetch("/api/auth/unlock-dashboard", { method: "POST" })
      if (!response.ok) {
        throw new Error("Failed to unlock dashboard")
      }

      router.push("/dashboard")
      router.refresh()
    } catch {
      router.push("/login")
    } finally {
      setLaunchingDashboard(false)
    }
  }

  const handleOpenFeature = async (href: string, event?: React.MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault()
    if (launchingDashboard) return

    setLaunchingDashboard(true)
    try {
      const response = await fetch("/api/auth/unlock-dashboard", { method: "POST" })
      if (!response.ok) throw new Error("Failed to unlock dashboard")

      router.push(href)
      router.refresh()
    } catch {
      router.push("/login")
    } finally {
      setLaunchingDashboard(false)
    }
  }

  const handleOpenDetection = () => handleOpenFeature("/dashboard/detection")

  return (
    <div className="w-full font-sans">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* layered background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1e3a23] via-[#2d5a34] to-[#1a4a22]" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 60%, #6ee76e 0%, transparent 50%), radial-gradient(circle at 80% 20%, #a3e635 0%, transparent 45%)",
          }}
        />
        {/* subtle grid texture */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 text-center">
          {/* badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-semibold text-white/80 uppercase tracking-widest mb-8 animate-fade-in-up">
            <Cpu className="h-3 w-3 text-lime-400" />
            AI-Powered Farm Intelligence
          </div>

          <h1
            className="text-5xl md:text-7xl font-extrabold text-white leading-[1.08] tracking-tight mb-6 animate-fade-in-up"
            style={{ animationDelay: "0.1s" }}
          >
            Bhoomitra
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-lime-300 to-emerald-300">
              Crop Intelligence
            </span>
          </h1>

          <p
            className="max-w-2xl mx-auto text-lg text-white/70 leading-relaxed mb-10 animate-fade-in-up"
            style={{ animationDelay: "0.2s" }}
          >
            Smartphone disease detection · severity-weighted risk modeling · precision spray planning ·
            zone-level farm intelligence — unified in one platform.
          </p>

          <div
            className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in-up"
            style={{ animationDelay: "0.3s" }}
          >
            <button
              type="button"
              onClick={handleLaunchDashboard}
              disabled={launchingDashboard}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-lime-400 hover:bg-lime-300 text-[#1e3a23] font-bold text-base transition-all duration-200 shadow-lg hover:shadow-lime-400/40 hover:-translate-y-0.5"
            >
              {launchingDashboard ? "Opening..." : "Launch Dashboard"} <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleOpenDetection}
              disabled={launchingDashboard}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-base transition-all duration-200 backdrop-blur"
            >
              <Brain className="h-4 w-4" /> {launchingDashboard ? "Opening..." : "Try Disease Detection"}
            </button>
          </div>
        </div>
      </section>

      {/* ── System Status Strip ──────────────────────────────────────────── */}
      <section className="bg-[#1e3a23] border-b border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-3 flex flex-wrap gap-3 justify-center">
          <StatusPill icon={Cpu} label="AI-assisted" value="Ready" color="text-lime-400" />
          <StatusPill icon={Layers} label="Farm coverage" value="Zone-wise" color="text-emerald-400" />
          <StatusPill icon={FlaskConical} label="Workflow" value="Detect → Decide → Act" color="text-cyan-400" />
          <StatusPill icon={Shield} label="Demo status" value="Operational" color="text-lime-400" />
        </div>
      </section>

      {/* ── Feature Cards ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-[#1e3a23] mb-3">Platform Capabilities</h2>
          <p className="text-[#5a7a60] text-base max-w-xl mx-auto">
            A practical workflow for small and marginal farms: detect early, act precisely, and keep an auditable record.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <FeatureCard
              key={f.href}
              {...f}
              delay={`${i * 0.07}s`}
              onOpen={(event) => handleOpenFeature(f.href, event)}
            />
          ))}
        </div>
      </section>

      <section className="bg-[#f7fbf4] border-y border-[#d4e9c8]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#3a7d44] mb-3">Designed for MSME-scale adoption</p>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1e3a23] mb-3">High-value decisions, without high-cost infrastructure.</h2>
            <p className="text-[#5a7a60] leading-relaxed">Bhoomitra turns a crop photo and field observation into a clear next action, then keeps the decision trail ready for farmers, FPOs, input partners, and field teams.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { title: "1. Capture", text: "Use a smartphone image and basic field details—no specialist equipment required.", icon: Brain },
              { title: "2. Prioritise", text: "See severity, affected zone, and a recommended response before applying inputs.", icon: Shield },
              { title: "3. Prove", text: "Track detections and interventions in one place for follow-up and better seasonal decisions.", icon: BarChart3 },
            ].map(({ title, text, icon: Icon }) => (
              <div key={title} className="rounded-2xl bg-white border border-[#d4e9c8] p-6 shadow-sm">
                <Icon className="h-6 w-6 text-[#3a7d44] mb-4" />
                <h3 className="font-bold text-[#1e3a23] mb-2">{title}</h3>
                <p className="text-sm leading-relaxed text-[#5a7a60]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Bhoomitra ──────────────────────────────────────────────── */}
      <section className="bg-white border-y border-[#d4e9c8]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-[#1e3a23] mb-3">Why Bhoomitra?</h2>
            <p className="text-[#5a7a60]">The difference intelligence makes at every decision point.</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#d4e9c8] shadow-sm">
            {/* header row */}
            <div className="grid grid-cols-3 bg-[#1e3a23] text-white text-sm font-semibold">
              <div className="px-5 py-3 text-white/60">Decision Point</div>
              <div className="px-5 py-3 border-l border-white/10 flex items-center gap-2">
                <X className="h-3.5 w-3.5 text-red-400" /> Traditional Farming
              </div>
              <div className="px-5 py-3 border-l border-white/10 flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-lime-400" /> Bhoomitra AI
              </div>
            </div>

            {comparison.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-3 text-sm border-t border-[#d4e9c8] ${i % 2 === 0 ? "bg-[#f7fbf4]" : "bg-white"}`}
              >
                <div className="px-5 py-4 font-medium text-[#1e3a23]">{row.label}</div>
                <div className="px-5 py-4 border-l border-[#d4e9c8] text-[#8a9e8e]">{row.traditional}</div>
                <div className="px-5 py-4 border-l border-[#d4e9c8] text-[#2d6a35] font-medium">{row.ai}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#2d5a34] to-[#1a3e20]" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "radial-gradient(circle at 70% 50%, #a3e635 0%, transparent 55%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-5 leading-tight">
            Start Intelligent Farming Today
          </h2>
          <p className="text-white/65 text-lg mb-10 max-w-xl mx-auto">
            Let AI support risk modeling, spray planning, and disease detection — so you can focus on growing.
          </p>
          <button
            type="button"
            onClick={handleLaunchDashboard}
            disabled={launchingDashboard}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-lime-400 hover:bg-lime-300 text-[#1e3a23] font-bold text-base transition-all duration-200 shadow-xl hover:shadow-lime-400/40 hover:-translate-y-0.5"
          >
            {launchingDashboard ? "Opening..." : "Launch Dashboard"} <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* ── Footer strip ────────────────────────────────────────────────── */}
      <footer className="bg-[#1e3a23] text-white/40 text-xs text-center py-4">
        © {new Date().getFullYear()} Bhoomitra · AI Crop Intelligence Platform
      </footer>
    </div>
  )
}
