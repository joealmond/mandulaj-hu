/**
 * Social preview card, in the site's own typography.
 *
 * Written with a small `el()` helper rather than JSX on purpose: this module is
 * executed by tsx inside a build script, where the JSX runtime resolution is
 * fragile (a classic-runtime transform reaches for a `React` global that is not
 * there). satori consumes plain {type, props} objects natively, so skipping JSX
 * removes a whole class of build-only breakage.
 *
 * Two satori constraints to remember when editing: it supports flexbox ONLY, so
 * every container needs an explicit `display: "flex"`, and it cannot resolve CSS
 * custom properties, so colours are literals rather than var(--accent).
 *
 * The card reads its accent and ID from .publish-manifest.json so a shared link
 * previews in the same colour as the page it opens.
 */
import fs from "node:fs"
import path from "node:path"

// Light-mode values only: OG cards always render on the paper background.
// Keep in sync with scripts/gen-accents.ts.
const ACCENTS: Record<string, string> = {
  vermilion: "#CD311D",
  ochre: "#92640D",
  verdigris: "#3F6B5F",
  ultramarine: "#1F3FA8",
  aubergine: "#5B3A8C",
  oxblood: "#7A2540",
}

const PAPER = "#F2EFE6"
const INK = "#16130F"
const META = "#6F6857"

type Style = Record<string, string | number>
interface El {
  type: string
  props: { style?: Style; children?: El[] | string }
}

const el = (type: string, style: Style, children?: El[] | string): El => ({
  type,
  props: { style, children },
})

interface Entry {
  slug: string
  accent?: string
  zk?: string
}

let manifest: Entry[] | null = null
function lookup(slug: string): { accent: string; zk: string } {
  if (!manifest) {
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), ".publish-manifest.json"), "utf8")
      manifest = (JSON.parse(raw) as { notes: Entry[] }).notes
    } catch {
      manifest = []
    }
  }
  const hit = manifest.find((n) => n.slug === slug)
  return {
    accent: ACCENTS[hit?.accent ?? ""] ?? ACCENTS.ultramarine,
    zk: hit?.zk ?? "0000",
  }
}

export interface ImageArgs {
  title: string
  description: string
  fileData: { slug?: string }
}

export const kassakCard = ({ title, description, fileData }: ImageArgs): El => {
  const { accent, zk } = lookup(fileData?.slug ?? "")

  // Long titles need a smaller setting or they overflow the card.
  const size = title.length > 68 ? 58 : title.length > 40 ? 72 : 88

  const row = (style: Style, children: El[]) => el("div", { display: "flex", ...style }, children)

  return row(
    {
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: PAPER,
      padding: "60px 72px",
      justifyContent: "space-between",
    },
    [
      // ── ID block + heavy rule, mirroring the page header
      row({ flexDirection: "column", width: "100%" }, [
        row({ alignItems: "flex-end", width: "100%" }, [
          el(
            "div",
            {
              display: "flex",
              backgroundColor: accent,
              color: PAPER,
              fontFamily: "Archivo",
              fontWeight: 800,
              fontSize: 40,
              padding: "8px 22px 6px",
              letterSpacing: 1,
            },
            zk,
          ),
          el("div", { display: "flex", flexGrow: 1 }),
          el(
            "div",
            {
              display: "flex",
              fontFamily: "Libre Franklin",
              fontSize: 21,
              color: META,
              letterSpacing: 2,
              paddingBottom: 8,
            },
            "MANDULAJ.HU",
          ),
        ]),
        el("div", { display: "flex", height: 8, backgroundColor: INK, width: "100%" }),
      ]),

      // ── Title
      row({ flexDirection: "column", flexGrow: 1, paddingTop: 40 }, [
        el(
          "div",
          {
            display: "flex",
            fontFamily: "Archivo",
            fontWeight: 800,
            fontSize: size,
            color: INK,
            lineHeight: 1.05,
            textTransform: "uppercase",
            letterSpacing: -1.5,
          },
          title,
        ),
      ]),

      // ── Register mark + description
      row({ flexDirection: "column", width: "100%" }, [
        row({ alignItems: "center", width: "100%", paddingBottom: 18 }, [
          el("div", { display: "flex", width: 150, height: 8, backgroundColor: INK }),
          el("div", { display: "flex", width: 18 }),
          el("div", { display: "flex", width: 60, height: 8, backgroundColor: accent }),
        ]),
        el(
          "div",
          {
            display: "flex",
            fontFamily: "Libre Franklin",
            fontSize: 26,
            color: META,
            lineHeight: 1.45,
          },
          (description ?? "").slice(0, 155),
        ),
      ]),
    ],
  )
}

export default kassakCard
