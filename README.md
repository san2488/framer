# Collage Maker

A small, local-first photo collage editor for printable 4 × 6 photo paper.

## Features

- Two-photo layout with equal halves
- Three-photo layout with one large landscape slot and two portrait slots
- JPEG, PNG, HEIC, and HEIF uploads
- Drag, zoom, rotate, replace, and remove photos
- 1 mm white cutting gutters
- Browser printing at 4 × 6 inches
- 1200 × 1800 PNG export for 300 DPI printing
- Photos are processed locally in the browser

## Requirements

- Node.js 22.13 or newer
- pnpm

## Run locally

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
pnpm build
```

## Notes

HEIC and HEIF conversion happens in the browser and can take a moment for large files. No photos are uploaded to a server.
