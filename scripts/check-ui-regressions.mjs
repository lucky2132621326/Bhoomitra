/**
 * Source-level regression guards for the two defects fixed in the mobile /
 * multilingual pass. Dependency-free so it can run in CI as-is.
 *
 * Run: node scripts/check-ui-regressions.mjs
 */
import { readFileSync, existsSync } from "node:fs"

let failures = 0
const check = (ok, message) => {
  if (ok) return
  failures += 1
  console.error(`FAIL ${message}`)
}

const dashboardLayout = readFileSync("app/dashboard/layout.tsx", "utf8")
const dashboardPage = readFileSync("app/dashboard/page.tsx", "utf8")
const rootLayout = readFileSync("app/layout.tsx", "utf8")

// --- Mobile sidebar ---------------------------------------------------------
check(
  /className=\{`fixed left-0 top-0 z-50 hidden [^`]*md:flex/.test(dashboardLayout),
  "desktop sidebar must be hidden below 768px (expected `hidden ... md:flex` on <aside>)",
)
check(
  dashboardLayout.includes('md:ml-72') && dashboardLayout.includes('md:ml-20'),
  "main content must only reserve the sidebar margin at md and above",
)
check(
  !/\bml-72"|\bml-20"/.test(dashboardLayout.replace(/md:ml-(72|20)/g, "")),
  "main content must not apply an unscoped sidebar margin (breaks mobile layout)",
)
check(dashboardLayout.includes("md:hidden"), "a mobile-only header must exist below 768px")
check(
  dashboardLayout.includes("<Sheet") && dashboardLayout.includes("SheetContent"),
  "mobile navigation must use the accessible Sheet drawer",
)
check(
  dashboardLayout.includes("setMobileNavOpen(false)"),
  "the mobile drawer must close after navigation",
)
check(
  dashboardLayout.includes("adminOnly") && dashboardLayout.includes('role === "admin"'),
  "role restrictions must still gate admin-only routes",
)

// --- Stale text on language switch -----------------------------------------
check(
  !existsSync("components/global-runtime-translator.tsx"),
  "GlobalRuntimeTranslator must not be reintroduced (it mutated DOM text and restored stale values)",
)
check(
  !rootLayout.includes("GlobalRuntimeTranslator"),
  "GlobalRuntimeTranslator must not be mounted in the render path",
)
for (const [file, source] of [
  ["app/dashboard/layout.tsx", dashboardLayout],
  ["app/dashboard/page.tsx", dashboardPage],
  ["app/layout.tsx", rootLayout],
]) {
  check(!source.includes("MutationObserver"), `${file} must not translate by observing DOM mutations`)
  check(!source.includes("nodeValue"), `${file} must not translate by rewriting text node values`)
}
check(
  !dashboardPage.includes("Your farm is healthy today"),
  "the healthy-farm message must render from a translation key, not a hardcoded literal",
)
check(
  dashboardPage.includes('t("dashboard.noActiveDetections")') &&
    dashboardPage.includes('tPlural("dashboard.zonesNeedAttention"'),
  "active-detection copy must be rendered from translation keys",
)

// --- Five-language support -------------------------------------------------
// A merge once silently narrowed these back to English + Hindi, which stranded
// Marathi/Tamil/Telugu farmers on English without any test failing.
const LANGS = ["en", "hi", "mr", "ta", "te"]
const languageContext = readFileSync("lib/language-context.tsx", "utf8")
const selector = readFileSync("components/language-selector.tsx", "utf8")

for (const lang of LANGS) {
  check(
    new RegExp(`export type Language =[^\\n]*"${lang}"`).test(languageContext),
    `Language union must include "${lang}"`,
  )
  check(
    new RegExp(`SUPPORTED_LANGUAGES[^\\n]*"${lang}"`).test(languageContext),
    `SUPPORTED_LANGUAGES must include "${lang}"`,
  )
  check(
    new RegExp(`code: "${lang}"`).test(selector),
    `the language selector must offer "${lang}"`,
  )
  check(
    new RegExp(`\\b${lang}: "`).test(languageContext),
    `LOCALE_BY_LANGUAGE must map "${lang}" to a locale`,
  )
}
check(
  !/language === "hi" \? "hi-IN"/.test(languageContext + selector),
  "locale selection must go through localeFor(), not a two-language ternary",
)

if (failures) {
  console.error(`\n${failures} UI regression check failure(s)`)
  process.exit(1)
}
console.log("All UI regression checks passed.")
