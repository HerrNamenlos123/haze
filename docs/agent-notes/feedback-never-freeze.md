# Haze apps never freeze

Standing requirement: haze apps (haze-notes first) stay fully responsive under any load.

Verified 2026-11-04 against d35a505e. (the mechanism that implements it is [[haze-notes-never-freeze-architecture]])

- Any work whose size scales with document content (tile rendering, tessellation, outline computation, JSON save, image decode) must be bounded per frame: time-sliced with a budget, cached, or moved off the frame path. The UI shows something cheap meanwhile (stretched old tiles, a blank page).
- "Only slow once" or "only on big files" is not acceptable: real documents are large (tens of MB).
