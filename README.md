# Exam Paper Translator

A free web app for translating question papers **English ⟷ Afrikaans** while keeping
diagrams, layout order and scientific notation (x², subscripts, Δ, formulas) intact.
Built for Elizabeth Hanekom (Physical Sciences & Geography).

## How it works (all free — no paid API, no per-page cost)

| Step | Tool | Runs |
|------|------|------|
| Read the PDF | **PDF.js** (digital text layer) → **Tesseract.js** OCR fallback for scans | in the browser |
| Translate | **Glossary first** (confirmed IEB terms) → **MyMemory** free machine translation for the rest | in the browser |
| Rebuild | **docx.js** — Word document, reading order + super/subscript preserved | in the browser |
| Store / library / share | **Supabase** free tier (auth, Postgres, storage) | cloud |
| Host | **GitHub Pages** | cloud |

Numbers, formulas and equations are detected and left untouched. Machine-translated
text is flagged yellow for review; glossary matches are green (trusted).

## Files
- `index.html` / `styles.css` / `app.js` — the app (login-gated)
- `share.html` — public view/download-only page for a shared paper (no login)
- `manifest.webmanifest` / `sw.js` / `icon-*.png` — PWA shell
- `test.html` + `sample.pdf` — local engine test only (git-ignored, never deployed)

## Backend
Supabase project `hontxqtggrvxybamqrnh` (shared), tables `ext_papers` + `ext_glossary`,
storage bucket `ext-papers` (private). All rows are row-level-security scoped to the
logged-in teacher; shared papers are served through the `ext_get_shared_paper` RPC.

## Known limits of the free build
- Digital PDFs work best. Scanned/photographed papers use OCR and need more review-step cleanup.
- Un-glossaried text is machine-translation quality — the review step + glossary are the accuracy net.
- MyMemory has a free daily word limit; heavy days may leave some blocks untranslated (flagged, editable).
- Diagram placement is structural, not pixel-perfect (pixel-perfect overlay is a v2 goal).
