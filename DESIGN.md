# Do It Laaaaaater — Figma Design System Specification

North Star: **"White gallery wall with a single indigo spotlight."**
Source reference: Figma Design System (`https://styles.refero.design/style/5fd3b3b4-02ab-456a-87aa-e4395636b671`).

## 1. Color Discipline (Strictly Achromatic + Single Indigo Spotlight)
- `--bg-canvas`: `#ffffff` (Paper White — primary page background)
- `--bg-surface`: `#ffffff` (Card surface, separated by hairline borders or whitespace)
- `--bg-subtle`: `#f5f5f5` (Soft hover & subtle panel background)
- `--bg-mist`: `#e2e2e2` (Soft Mist — dividers, muted chips, secondary panels)
- `--text-primary`: `#000000` (Ink Black — primary text, icons, high-contrast strokes)
- `--text-muted`: `#595959` (Graphite — secondary metadata, helper copy, timestamps)
- `--border-subtle`: `rgba(0, 0, 0, 0.10)` (Default card & divider hairline)
- `--border-strong`: `#000000` (Ghost/outlined buttons, active focus rings)
- `--accent`: `#4d49fc` (Electric Indigo — **sole saturated primary CTA fill** & active highlight)
- `--accent-hover`: `#3c38e0`
- `--accent-soft`: `rgba(77, 73, 252, 0.08)` (Subtle active nav/tag tint)
- `--danger`: `#e02424` (Destructive actions only — permanent delete, overdue badge)
- `--success`: `#16a34a` (Saved/synced indicator)
- Brand Logo Mark (4-color geometric mark at top-left, 22-24px): `#00b6ff`, `#24cb71`, `#ff7237`, `#4d49fc`

## 2. Strict Four-Tier Border Radius Language
- `--radius-xs`: `2px` — fine UI badges, tiny indicators, dividers
- `--radius-sm`: `8px` — ghost/outlined buttons, text inputs, selects, icon buttons, search bar
- `--radius-md`: `16px` — cards, modals, drawers, popovers, gallery thumbnails
- `--radius-pill`: `50px` (`9999px`) — primary Electric Indigo CTA buttons, pill nav buttons, filter/tag chips

## 3. Typography
- Primary sans: `'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
- Monospace (metadata, dates, counts, URLs, shortcuts): `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (`letter-spacing: +0.03em`)
- Display/Section headlines: weight `300`–`400`, tight tracking `-0.015em` to `-0.02em`, line-height `1.15` (whisper-weight authority, never heavy bold)
- Card titles: `15px`–`16px`, weight `500`, `#000000`, line-height `1.4`
- Body & controls: `14px`–`15px`, weight `400`, line-height `1.45`
- Metadata/annotations: `12px` mono/sans, `#595959`

## 4. Elevation Philosophy
- Flat by default! Cards in lists and gallery grids have **NO drop shadow** — only hairline borders (`1px solid rgba(0,0,0,0.09)`) and generous spacing.
- **Single signature floating shadow** (`--shadow-float: 0 24px 70px rgba(0, 0, 0, 0.10)`): reserved strictly for floating modals, popovers, floating bulk action pill bar, auth card, and toast notifications.

## 5. Shared CSS Class Conventions (so all components stay 100% unified)
- Buttons:
  - `.btn` (base inline-flex button)
  - `.btn-primary` (`#4d49fc` fill, `#ffffff` text, `50px` pill radius)
  - `.btn-black` (`#000000` fill, `#ffffff` text, `50px` pill radius)
  - `.btn-ghost` (transparent fill, `1px solid #000000`, `#000000` text, `8px` radius)
  - `.btn-subtle` (`#f5f5f5` fill, `#000000` text, `8px` radius)
  - `.btn-danger` (outlined/filled red destructive button, `8px` radius)
  - `.btn-text` (borderless text button)
  - `.btn-icon` (square/compact icon button, `8px` radius)
  - Size modifiers: `.btn-sm`, `.btn-lg`, `.btn-block`
- Form Controls:
  - `.input`, `.textarea`, `.select` (`1px solid rgba(0,0,0,0.18)`, `8px` radius, focus `border-color: #000000`)
  - `.field` (vertical label + control stack), `.field-label`, `.field-hint`
- Chips & Badges:
  - `.pill` (`50px` radius filter/category chip, `.is-active` uses `#000000` or `#4d49fc`)
  - `.badge` (`2px` radius fine mono label), `.badge-danger`, `.badge-indigo`, `.badge-muted`
  - `.cat-dot` (`7px` circle colored by category color)
- Notices & Progress:
  - `.notice`, `.notice-error`, `.notice-success`, `.notice-info`
  - `.progress-bar`, `.progress-fill`
- Layout & Surfaces:
  - `.fig-header` (64px flush white top bar, max-width 1360px centered)
  - `.fig-shell` (sidebar + main workspace)
  - `.fig-sidebar` (224px collapsible left nav)
  - `.fig-modal-backdrop`, `.fig-modal` (`16px` radius, `--shadow-float`)
  - `.fig-popover` (`16px` radius, `1px solid rgba(0,0,0,0.1)`, `--shadow-float`)
  - `.fig-card` (`16px` radius, white surface, `1px solid rgba(0,0,0,0.09)`, no shadow)
  - `.fig-gallery-grid` (responsive 4-column desktop / 2-column tablet / 1-column mobile, `20px`–`24px` gap)
  - `.fig-list` (clean vertical compact rows separated by 1px hairlines)
