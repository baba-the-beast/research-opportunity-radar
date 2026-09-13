---
name: Research Opportunity Radar
colors:
  surface: '#0f141a'
  surface-dim: '#0f141a'
  surface-bright: '#353a40'
  surface-container-lowest: '#0a0f14'
  surface-container-low: '#171c22'
  surface-container: '#1b2026'
  surface-container-high: '#252a31'
  surface-container-highest: '#30353c'
  on-surface: '#dee3eb'
  on-surface-variant: '#d4c4b3'
  inverse-surface: '#dee3eb'
  inverse-on-surface: '#2c3137'
  outline: '#9d8e7f'
  outline-variant: '#504538'
  surface-tint: '#f8bb6a'
  primary: '#f8bb6a'
  on-primary: '#462b00'
  primary-container: '#c08a3e'
  on-primary-container: '#412800'
  inverse-primary: '#825509'
  secondary: '#9ed1be'
  on-secondary: '#00382b'
  secondary-container: '#205143'
  on-secondary-container: '#90c3b0'
  tertiary: '#ffb4a3'
  on-tertiary: '#630f00'
  tertiary-container: '#eb7054'
  on-tertiary-container: '#5d0e00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffddb5'
  primary-fixed-dim: '#f8bb6a'
  on-primary-fixed: '#2a1800'
  on-primary-fixed-variant: '#643f00'
  secondary-fixed: '#b9eeda'
  secondary-fixed-dim: '#9ed1be'
  on-secondary-fixed: '#002118'
  on-secondary-fixed-variant: '#1d4f41'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a3'
  on-tertiary-fixed: '#3d0600'
  on-tertiary-fixed-variant: '#84250f'
  background: '#0f141a'
  on-background: '#dee3eb'
  surface-variant: '#30353c'
typography:
  headline-xl:
    fontFamily: Libre Caslon Text
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 40px
  headline-lg:
    fontFamily: Libre Caslon Text
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 32px
  headline-md:
    fontFamily: Libre Caslon Text
    fontSize: 19px
    fontWeight: '400'
    lineHeight: 26px
  headline-sm:
    fontFamily: Libre Caslon Text
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 22px
  body-lg:
    fontFamily: Public Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Public Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Public Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  data-mono-lg:
    fontFamily: Space Mono
    fontSize: 15px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: -0.02em
  data-mono-md:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: -0.01em
  data-mono-sm:
    fontFamily: Space Mono
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: Space Mono
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.08em
spacing:
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
  gutter: 1px
  margin-screen: 1.5rem
---

## Brand & Style

This design system is tailored for an academic research-intelligence instrument built for university faculty, principal investigators, and provost offices. It rejects generic modern SaaS patterns—prohibiting consumer-facing gradient washes, floating rounded cards, inflated empty margins, and decorative marketing heroes. 

The aesthetic is that of a scholarly observatory instrument: austere, authoritative, optically precise, and engineered for sustained, high-density analytical work. It evokes physical astronomical instruments, library ledger archives, and specialized research consoles. Every interface surface serves to convey data clarity, structural hierarchy, and intellectual focus.

## Colors

The system uses a strictly dark-themed, low-glare chromatic structure calibrated for long reading sessions and complex visual telemetry:

- **Ink (`#10151B`)**: Canvas foundation and root application background. Deep, blue-tinted void that prevents eye fatigue.
- **Panel (`#171E27`)**: Structural cell surface, table container, and structural divider. Used to establish 1px architectural grid lines and low-contrast surface strata without floating elevation.
- **Parchment (`#EDE6D6`)**: Primary typographic color. A warm, non-reflective off-white ensuring exceptional legibility across prolonged academic review.
- **Brass (`#C08A3E`)**: The primary mechanical accent. Used for active states, link targets, radar crosshairs, telemetry sweep indicators, and high-priority scholarly opportunity highlights.
- **Verdigris (`#5B8C7B`)**: Semantic positive state indicating strong institutional relevance, favorable funding match confidence, and active pursuit vectors.
- **Rust (`#B5482F`)**: Critical/urgent semantic status indicating impending submission cutoffs (<7 days), archival exclusions, or dismissed grants.
- **Muted Ledger (`#7E8B9B`)**: Subdued secondary text used for field labels, metadata tags, and monospaced catalog markers.

## Typography

Typography establishes an intentional academic tension between archival scholarship and scientific telemetry:

- **Display & Headings**: Set in literary, historical serif type (`Libre Caslon Text`). Preserves the gravity of academic grants, discipline titles, and institutional papers without feeling promotional.
- **Body & Interface**: Neutral, highly legible humanist sans (`Public Sans`) optimized for dense abstracts, eligibility clauses, and administrative parameters.
- **Numeric & Telemetry Metrics**: Fixed-width tabular monospace (`Space Mono`). Deployed strictly for funding amounts, radar match coefficients, submission countdowns, and grant identification numbers.

All numeric figures must maintain tabular baseline alignment across comparative tables and matrices.

## Layout & Spacing

The layout is grounded in a continuous, high-density scientific console grid rather than floating detached cards.

- **Grid Architecture**: Content spans a full-bleed viewport segmented by strict 1px architectural grid lines colored in Panel (`#171E27`) and dark boundaries. Spacing is tight, compact, and structural.
- **Rhythm**: Standard spacing increments operate on a 4px sub-grid with base unit steps of 4px, 8px, 12px, 16px, and 24px. Large margins exceeding 32px are forbidden inside operational data areas.
- **Reflow & Responsive Behavior**:
  - **Desktop (>1280px)**: Three-tier instrument layout—fixed left vertical directory (280px), primary radar matrix/tabular stream (fluid), and right-hand grant intelligence inspection pane (420px).
  - **Tablet (768px - 1279px)**: Collapsible index drawer, telemetry tabular pane remains continuous, inspection pane shifts to an edge-anchored overlay.
  - **Mobile (<768px)**: Stacked single-column tabular cells, horizontal scrolling enabled for multi-column metrics, fixed sticky bottom readout for opportunity scores.

## Elevation & Depth

This design system deliberately excludes drop shadows, ambient blurs, and pseudo-physical elevation. Depth is conveyed strictly through **tonal layering**, **ruled perimeter borders**, and **tactile status insets**:

1. **Substrate (Ink `#10151B`)**: Baseline page canvas, void state, and unselected background.
2. **Structural Planes (Panel `#171E27`)**: Tonal plateaus for data rows, radar plot viewports, and metadata tables. Boundaries are delineated by crisp 1px borders (`rgba(237, 230, 214, 0.08)` or `#171E27`).
3. **Selected / Focus Active State**: Surfaces do not raise upward; they receive a 1px solid interior boundary of Brass (`#C08A3E`) or a subtle background tint of Brass at 5% opacity (`rgba(192, 138, 62, 0.05)`).
4. **Modal Overlays & Popovers**: Pure flat surfaces rendered in `#171E27` bounded by a hard 1px outline in `#5B8C7B` or `#C08A3E` without drop shadows.

## Shapes

The geometric vocabulary is uncompromisingly sharp (`0px` corner radius). 

Every container, data cell, badge, button, and input element is engineered with right angles. Curves and pills are strictly reserved for circular scientific visualization plots (such as polar radar projections, radial score gauges, and scope Reticles). Rectilinear construction conveys structural reliability, tabular permanence, and laboratory discipline.

## Components

### Buttons & Instrument Triggers
- **Primary Action**: Flat rectangle. Background: `Brass (#C08A3E)`; Text: `Ink (#10151B)`; Font: `Space Mono`, bold, 11px uppercase. Padding: 6px 14px. Hover: background transitions to `#D8A050`. Border: 0px.
- **Secondary Action**: Background: transparent; Text: `Parchment (#EDE6D6)`; Border: 1px solid `rgba(237, 230, 214, 0.2)`. Hover: Border color shifts to `Brass (#C08A3E)`.
- **Destructive/Dismiss Action**: Background: transparent; Text: `Rust (#B5482F)`; Border: 1px solid `rgba(181, 72, 47, 0.4)`. Hover: Background fills `rgba(181, 72, 47, 0.15)`.

### Chips, Status Badges & Match Scores
- **Geometry**: Sharp 0px rectangles, 20px fixed height, inline-flex alignment.
- **Format**: Monospace uppercase text (`Space Mono`, 10px).
- **Match Bands**:
  - **High Relevance / Pursuing**: Background `rgba(91, 140, 123, 0.12)`, text `Verdigris (#5B8C7B)`, 1px left-edge bar in solid Verdigris.
  - **Critical Deadline (<7 Days)**: Background `rgba(181, 72, 47, 0.15)`, text `Rust (#B5482F)`, 1px left-edge bar in solid Rust.
  - **Standard Observation**: Background `#171E27`, text `Muted Ledger (#7E8B9B)`, border 1px solid `rgba(237, 230, 214, 0.1)`.

### Tables & Opportunity Data Rows
- **Layout**: Dense ledger row formats. 36px default height for compact mode, 48px for expanded mode.
- **Borders**: 1px horizontal rule between records using `#171E27`.
- **Hover/Selected State**: Hover evokes an instant surface tint of `#1A232E`. Active/Selected row features a solid 2px left border in `Brass (#C08A3E)`.
- **Column Alignments**: Scientific values, match scores, funding totals, and deadlines right-aligned in `Space Mono`. Scholarly titles left-aligned in `Libre Caslon Text`.

### Inputs & Filter Elements
- **Field Base**: Background `Ink (#10151B)`, border 1px solid `rgba(237, 230, 214, 0.15)`. Text: `Parchment (#EDE6D6)`. Font: `Public Sans`, 13px.
- **Focus**: Border switches to 1px solid `Brass (#C08A3E)`. No glow or outline ring.
- **Checkboxes & Radios**: Square 12px boxes (`0px` radius). Checked state displays a solid Brass center block.

### Radar Instrument Viewport
- **Canvas**: Circular polar coordinate grid drawn with 1px concentric rings and cardinal axes in `rgba(237, 230, 214, 0.08)`.
- **Telemetry Indicators**: Plotted research opportunities rendered as 4px diamond markers colored by match status (Verdigris, Brass, or Rust). Active hover displays precise monospaced Cartesian readouts.