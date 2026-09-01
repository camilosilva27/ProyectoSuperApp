# Corellia Design System

Corellia is **sovanta's internal design system** for the **Innovation Factory** (IF) — a suite of SAP-BTP tooling that helps customers ship innovation projects through a staged "factory" metaphor (Design → Engineering → Production → Shipment, plus Monitoring, Parts, Service, Academy and Strategy).

> *"Corellia is known for producing starships, including the Millennium Falcon. Its shipyards and technology centers could be seen as sources of innovation."* — Corellia cover, March 2024, Timo Eising (sovanta).

The system sits on top of SAP's **Horizon / Fiori** visual language — it uses SAP's **72** type family, the **SAP-icons** icon font, and the canonical **Azure Blue `#0070F2`** primary action color — then layers on sovanta's own semantic "factory area" palette (sovanta Green for Production, Bayou Blue for Engineering, Golden Yellow for Design, etc.) and a signature library of **isometric 3D factory illustrations** rendered in area-specific colorways.

## Sources

- **Figma:** *Corellia – Design System* (mounted as a virtual filesystem; read-only, `.fig` archive attached to this project). 30 pages, 466 top-level frames — the cover is `/About/Design-Toolkit-Cover-Default` (node `55:5024`). Key pages in scope: `/Colors-Modes`, `/Typography`, `/Layout-Spacing`, `/Tokens`, `/Buttons`, `/Navigation`, `/Cards-Tiles`, `/Headers`, `/Header-Footer`, `/Filter-Bar`, `/Checkbox-Radio`, `/List-Item`, `/Modals`, `/NEW-Components`, `/Sections`, `/Feed-Timeline`, `/Tables`, `/Illustrations`, `/Jira-Icons`, `/Service-Icons`, `/People`, `/3D-Assets`.
- **Fonts (uploaded):** SAP **72** family (Regular, Semibold, Bold, Light, Italic, BoldItalic, Black, Condensed, CondensedBold, SemiboldDuplex) + SAP-icons font (`ttf` / `woff` / `woff2` / `eot`). All under `fonts/`.
- **Product context:** The Innovation Factory is a sovanta product for **SAP BTP** customers — it structures innovation work as moving through a factory (sketch ideas in Design, build in Engineering, ship from Production, monitor in Monitoring, etc.). The UI is application-dense: dashboards, KPI tiles, list-heavy project views, filter bars, modals, sidebars, and an "AI Chat" panel.

---

## Index

- **`colors_and_type.css`** — base tokens + semantic CSS variables. Import this file first.
- **`fonts/`** — the 72 + SAP-icons font files.
- **`assets/`** — logos, factory area illustrations, card background images, avatars.
- **`preview/`** — Design-System-tab preview cards (colors, type, components).
- **`ui_kits/innovation-factory/`** — click-through UI kit for the Innovation Factory product.
- **`SKILL.md`** — agent-invocable skill definition.

---

## Content Fundamentals

**Tone.** Neutral-professional, B2B-SaaS enterprise. The product is aimed at SAP customers' innovation / IT teams — people who live in Fiori-style tools all day. Copy is plain, direct, and functional. No exclamation marks, no "hey 👋", no marketing puffery. When the product explains a concept it does so in full sentences with proper casing.

Representative copy from the design (AI Chat scenario):

> *"Many customers have great ideas but lack the technical know-how or process guidance to bring them to life. Innovation initiatives often lose momentum due to unclear ownership, missing resources, or complex SAP architecture."*
>
> *"Thank you for your input. It looks like you didn't mention for which customer this idea is for. And you didn't mention a possible technology stack, maybe you can already tell me more about this."*

**Casing.** Sentence case everywhere — UI labels, button labels ("Button", "Approve", "Reject", "Attention", "Submit"), section headers ("Main Colors", "Additional Colors", "Border Radius"), nav items. Title Case only for proper nouns and product/area names (Innovation Factory, Design, Engineering, Production, Shipment, Monitoring, Parts, Service, Academy, Strategy).

**Person.** Third-person product voice for meta-UI. First-person ("my", as in "My Ideas", "My Projects") for the user's own workspace items. Second-person ("you", "your") in conversational surfaces like the AI Chat.

**Factory metaphor.** The product's vocabulary leans into manufacturing/factory terms — **Areas** (Design, Production, Shipment…), **Ideas** → **Projects** → **Apps** as the pipeline, **Phases**, **Tags**, **Line of Business**. Keep that vocabulary consistent; don't switch to generic SaaS words ("boards", "workspaces") where the factory term applies.

**Emoji.** Not used. The brand communicates state via SAP-icons glyphs and semantic colors, never emoji.

**Vibe.** Grown-up, calm, data-dense. Playfulness comes from the 3D factory illustrations — not from copy.

---

## Visual Foundations

### Colors
The Corellia palette is organized as a **12-stop scale** per hue (e.g. Azure Blue-10 `#E5F1FE` → Azure Blue-100 `#0070F2` → Azure Blue-130 `#004391`). The `-100` stop is the brand value; `-10/20/30` are tints for backgrounds and `-110/130` are shades for text-on-light and deep accents.

- **Neutrals:** White, Anchor Grey (text/UI chrome, `#232B31` darkest), Silver Grey (dividers/disabled), Light Steel Blue (application background `#F7F9FA`).
- **Primary action / info:** Azure Blue `#0070F2`.
- **Semantic status:** Success = sovanta Green `#3AAA35`, Warning = Pumpkin Orange `#E18700`, Error = Apple Red `#AA0808`, Neutral = Silver Grey, Information = Azure Blue.
- **Factory area tokens:** each IF area has an assigned hue — Design=Golden, Engineering=Bayou, Production=sovanta Green, Shipment=Silver, Parts=Pumpkin, Monitoring=Steel, Service=Lavender, Academy=Ocean, Strategy=Deep Purple. These drive area tags, chart series, and illustration colorways.
- **Additionals:** Turquoise, Deep Purple, Orchid Pink, Lavender Purple, Ocean Blue for data viz and decoration.

### Typography
- **Family:** SAP **72** everywhere — it's the whole type system. Body is 72 Regular 14 / 20, Semibold 14 / 20 is the default "H5" emphasis weight used on almost every card, section title and list item.
- **Scale:** 48 / 56 (Hero), 32 / 38 (H1, Bold and Light variants), 24 / 28 (H2), 20 / 24 (H3), 16 / 22 (H4), 14 / 20 (H5, body, button, tag), 12 / 16 (H6, caption).
- **Special:** 72 Light 32 is used for a softer H1; 72 Semibold 30 / 34 is the "Factory Area Cards Headline" style.
- **No display fonts, no serifs, no monospace.** The cover page uses Work Sans / Open Sans for the Figma-only "wrapper" — ignore that; the product itself is 72.

### Spacing
Strict **8-pt grid**. The tokens (`/Layout-Spacing/Spacing`) explicitly enumerate **8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120**. Card padding is almost always 16. Page gutters go 32→48→120 (covers). Gap-8 between inline icon + label is the default.

### Radii
Just two: **8px** for cards/tiles and **16px** for larger decorative surfaces. Buttons and inputs are **4px**. Pills/avatars are fully rounded.

### Borders & strokes
- Hairline divider: `#D6D6D6` (Silver-70).
- Default border: `#D8DADC` (Anchor Grey-20).
- Input border: `#D4DAE0`.
- Focus ring: Azure Blue `#0070F2`.
- Card separator inside lists: a 0.25px `#C7C7C7` top-rule.

### Shadows
Soft, low-intensity, blueish — not black drop shadows.
- Card: `0 1px 2px rgba(85,107,130,.16), 0 0 2px rgba(85,107,130,.16)`.
- Sticky shell chrome: `0 2px 2px rgba(85,107,130,.1), inset 0 -1px 0 rgba(85,107,130,.2)`.
- Popovers: `0 10px 30px rgba(0,0,0,.15)` (used rarely).

### Backgrounds / imagery
- Application background is **`#F7F9FA`** (Light Steel Blue-10). Cards sit on white inside that.
- Hero/header imagery is **3D isometric renders of "factory sections"** — each area (Design, Engineering, Production, Shipment, Parts, Monitoring, Strategy) has a square-ish isometric illustration in its area color (Design=yellow, Engineering=blue-grey, Production=green, Shipment=grey, Parts=orange, Monitoring=steel-blue). These replace generic stock photography.
- Card backgrounds for the pipeline ("Ideas", "Projects", "Apps") are **soft duotone isometric renders** with a semi-flat look.
- No repeating patterns, no grain/noise, no hand-drawn illustrations, no gradients-as-backgrounds. The only "texture" in the system is the 3D illustration render.

### Animation & motion
The Figma doesn't spec motion explicitly (static comps), so follow SAP Horizon conventions:
- Subtle **ease-out**, 150–250ms, for hover/press state changes.
- No bounces, no spring physics, no parallax.
- Fades for panel open/close; slide+fade for modals.
- Loading = a `StatusGreen` busy-indicator dot trio in the AI Chat, and a pulse of the card skeleton elsewhere.

### Hover & press
- **Hover (buttons):** background shifts to the next darker stop of its hue (Primary `#0070F2` → `#005AC1`). Tertiary buttons get a light Azure-10 fill. Borders keep their color.
- **Pressed:** opacity fades to ~0.5 on the label and icon, giving the "deboss" appearance the Figma "Pressed" state shows.
- **Disabled:** label and icon ~0.4 opacity on a tinted background; no change in cursor.
- **Focused:** a 1px outer Azure-100 ring around the control, rendered as a `box-shadow: 0 0 0 1px #0070F2` inset-like effect.

### Transparency & blur
Minimal. The system doesn't use glassmorphism, backdrop blur, or translucent overlays. Modals sit on a plain `rgba(0,0,0,0.4)` scrim.

### Layout rules
- Page shell is a **fixed top bar (44px)** + **optional left sidebar (64 collapsed / 260 expanded)** + content area.
- Content uses a **960 / 1200 / 1440 fluid container** with a 32px gutter.
- KPI tiles are 304×176 or 144×144 (S).
- List item row height = 48 default, 72 with subtitle, 96 with image.
- Tables are dense — 32px row height, 14px text, 8px cell padding.

### "Card" anatomy
Rounded 8px, white background, 1px `#D8DADC` border, `var(--shadow-card)`, 16px padding. A card header is 72 Semibold 16 / 22 with a 12 / 16 label underneath.

---

## Iconography

**Built-in icon font: SAP-icons.** The system uses SAP's stock icon font (included under `fonts/SAP-icons.woff2`). It's referenced in the Figma as `fontFamily: "SAP-icons"` at 14 / 16 / 18 / 24 / 28px with the full Private-Use-Area glyph set (arrow, menu, cart, warning, navigation-right, sys-enter, etc.). Render via `<span class="sapi"></span>`.

- We expose common glyphs via CSS classes in `assets/sap-icons.css` so you don't have to look up hex codepoints. Use them with `<i class="sapi icon-nav-back"></i>`.
- Icon colors: `currentColor`. Use `--fg-primary` (dark) by default, `--fg-active` for interactive, `--fg-label` for passive metadata icons.
- Icon sizes: 14 / 16 / 18 / 24 / 28px. Pair 14px icon with 14px text, 16px with 16/20px text.

**Jira icons.** The `/Jira-Icons` page carries a small extra set (issue type glyphs) used for project linking — included under `assets/jira/` when referenced.

**Service icons (307 frames).** The `/Service-Icons` page is a giant library of service/product logotypes (SAP Concur, SuccessFactors, Ariba, S/4, etc.). These are SVG logotypes, not UI icons. Copy on demand — we haven't bulk-copied them.

**Emoji: never used.** See Content Fundamentals.

**Unicode-as-icon: never used.** Arrows, stars, checks are all SAP-icons glyphs.

**SVGs vs. PNGs.** UI iconography = SAP-icons font. Illustrations = PNG renders of isometric 3D scenes (in `assets/`). Simple decorative marks = inline SVG.

---

## Caveats

- The Figma pseudocode is illustrative — long-form copy, deep instance overrides and exact per-character formatting may be off. Trust the JSX for structure and numeric tokens; trust screenshots only for visual gestalt.
- No sovanta / Corellia / Innovation Factory **wordmark** SVG was found in the file we could isolate — the product relies on the 3D illustrations and the "Innovation Factory" text lockup rather than a stand-alone logo.
- The cover page uses Work Sans & Open Sans — those are **Figma chrome**, not product type. Do not substitute these into product UI.
