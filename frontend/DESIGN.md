# Workspace design

## Audit and direction
The original interface combined legacy game typography with workspace controls,
heavy borders, competing status colors, and incremental overrides. The redesign
uses a Swiss direction: neutral surfaces, one blue accent, a single sans-serif
family, fine rules, and a compact navigation column. Game dialogue and notes keep
their content-specific treatments.

## Style ownership
Styles load in this order:

1. `src/styles/scenario.css`: imported scenario markup and content layouts.
2. `src/styles/app.css`: existing application component structures.
3. `src/styles/tokens.css`: shared semantic values and both theme variants.
4. `src/styles/workspace.css`: application presentation and responsive behavior.

Add semantic values to `tokens.css`; reuse existing classes before introducing
new controls. `--teal` is the compatibility name for the blue accent. Existing
status aliases remain compatible with the API's status names.

## Tokens and components
Spacing follows 4, 8, 12, 16, 24, 32, 48, and 64 px. Type roles range from 12 px
metadata to 32 px page titles. Controls use 4–8 px corner radii, subtle borders,
visible focus rings, and transitions of 160–220 ms. Numeric text uses tabular
figures. Colors express surface, text, accent, success, warning, and error roles.
Dark mode supports the saved preference and the system preference.

Existing buttons, fields, selects, badges, filters, tables, comments, previews,
inline alerts, empty states, loading indicators, and history rows share these
values. `Icon.tsx` supplies consistent decorative SVG navigation icons without
adding a dependency. Do not add pagination, switches, or notifications to screens
that do not need them.

## Responsive and accessible behavior
At 900 px the navigation becomes a drawer; 560 px enables single-column layouts
and larger touch controls. Tables scroll inside their containers. These media
query boundaries remain literal because CSS variables cannot drive media queries.

Keep the skip link, drawer focus handling, Escape behavior, native dialog focus
containment, and focus restoration. Image previews have keyboard triggers and
an explicit close button. Text identifies statuses independently of color.
Respect `prefers-reduced-motion`. Automated accessibility scans supplement manual
keyboard and visual checks; they do not establish full WCAG conformance.
