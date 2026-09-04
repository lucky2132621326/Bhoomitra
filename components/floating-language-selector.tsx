"use client"

import { usePathname } from "next/navigation"
import LanguageSelector from "@/components/language-selector"

/**
 * Public-page selector. Dashboard routes reserve their own toolbar/header
 * space at every breakpoint so this control never covers page content.
 */
export default function FloatingLanguageSelector() {
  const pathname = usePathname()
  const insideDashboard = pathname?.startsWith("/dashboard") ?? false

  if (insideDashboard) return null

  return (
    <div className="fixed right-4 top-4 z-[200]">
      <LanguageSelector />
    </div>
  )
}
