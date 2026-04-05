# Cereus & Limnic App

This app now follows the Hayden Brave pattern with two separate sibling modes:

- `reader.html` for the EPUB reading experience
- `listen.html` for the audiobook player

The root `index.html` is a mode selector that links to both.

## File placement

- Place the EPUB at the project root as `Cereus_and_Limnic.epub`
- Place audiobook files in `/audio`
- Place cover art, branding, and bundled vendor files in `/assets`
- Use `assets/cereus-limnic-cover.png` for the reader and home card
- Use `assets/cereus-limnic-audiobook-cover.png` for the audiobook mode
- Use `assets/HAC_studios_logo_2026.png` for branding

## Audiobook manifest

The audiobook page is driven by `manifest.json` at the project root. Supported fields:

```json
[
  {
    "id": 1,
    "title": "Chapter 1",
    "file": "chapter-01.mp3",
    "chapterLabel": "Chapter 01",
    "duration": 0
  }
]
```

- `id`, `title`, and `file` are the required fields used by the player
- `chapterLabel` is optional and lets you override the track label shown in the list
- `duration` is optional metadata if you want to store it for your own bookkeeping
- `file` is usually resolved relative to `/audio`, but direct relative or absolute paths also work if needed during migration

## Saved progress

Reading progress and listening progress are intentionally separate:

- `cereusLimnic.reading.position` stores the last EPUB CFI location
- `cereusLimnic.reading.theme` stores the active reader theme
- `cereusLimnic.reading.fontSize` stores the last reader font size
- `cereusLimnic.listening.track` stores the last selected audiobook track
- `cereusLimnic.listening.speed` stores the playback speed
- `cereusLimnic.listening.timestamp.<filename>` stores the saved listening position for each track

## Local run

Serve the folder over local HTTP instead of opening pages directly by `file://` when possible:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

Some browsers restrict EPUB and media loading when opened directly from `file://`, so local HTTP serving is the most reliable way to test both modes.
