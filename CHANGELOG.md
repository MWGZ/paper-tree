# Changelog

All notable user-facing changes are recorded here. The project follows semantic versioning while it is in early development.

## [0.3.3] — 2026-10-19

### Fixed

- Connector start points now use the actual text-line rectangles of multi-line highlights instead of the union bounding box.
- The start dot lands on the highlighted text rather than on a line gap or the citation number.

## [0.3.2] — 2026-10-19

### Changed

- Dragging or resizing a note now moves only that note window. Other note windows stay fixed.
- Related connector paths still update when a parent note moves; unrelated windows are untouched.

## [0.3.1] — 2026-10-19

### Changed

- Parent/child annotations may overlap; connectors prefer the visible side of the child card.
- Connector routing checks side ports (25/50/75% samples), path samples, and target-card interiors.
- One continuous child connector instead of a two-segment path.

## [0.3.0] — 2026-10-19

### Changed

- Child annotations use one continuous connector.
- Layer ordering keeps child windows above parent windows.
- Nested annotations are revealed progressively: click a highlight to open that annotation, then click inside it for the next level.

## [0.2.9] — 2026-10-19

### Fixed

- Child connector follows the parent note.
- Child connectors are no longer hidden by unrelated note windows.
- Minimizing a parent annotation minimizes its whole subtree.

## [0.2.8] — 2026-10-19

### Changed

- Moving a note only updates its own connector and its descendant connectors.
- Parent-to-child connectors are split around the parent card so they do not cover the direct child window.

## [0.2.7] — 2026-10-19

### Added

- Notes are anchored to content while scrolling.
- Left-button drag focuses the note first, then moves it.
- Four-side connector ports with automatic side switching when blocked.

## [0.2.6] — 2026-10-19

### Added

- All tree roots are rendered in one continuous, scrollable conversation window, ordered by question time.
- New questions append a new root at the bottom.
- Sidebar and graph navigation scroll to the corresponding root.

## [0.2.5] — 2026-10-19

### Added

- Three annotation states: minimized (highlight + number only), medium, maximized.
- `✕` minimizes directly to the highlight; no small-tab intermediate state.
- Medium size is resettable and not persisted across state changes.
- Parent annotation keeps its state when a child question is asked from it.

## [0.2.4] — 2026-10-19

### Changed

- Sidebar stays sharp and usable while an annotation is maximized.
- Annotation focus no longer dims or resizes unrelated notes.

## [0.2.3] — 2026-10-19

### Fixed

- Maximized annotation no longer blurs the sidebar.

## [0.2.2] — 2026-10-19

### Fixed

- Selecting text inside an annotation no longer resets the annotation to medium.
- Collapse-all keeps anchor highlights and note numbers.
- Sidebar can be collapsed from its header.
- Last focused/maximized/minimized note state is restored on relaunch.

## [0.2.1] — 2026-10-18

### Fixed

- “在主对话定位” now scrolls and flashes the target message.
- Added annotation maximize and nested annotations.
- Bottom composer creates a new root instead of a child node.
- Removed the separate new-root button.
- Responsive sidebar and note layout.

## [0.2.0] — 2026-10-18

### Added

- Annotation-note interface: select a sentence, create a sticky note, connector line, focus/dim states.
- Tree sidebar and full-screen structure graph.
- Sidebar collapse and responsive layout.

## [0.1.0] — 2026-10-18

### Added

- First desktop build: tree-structured paper Q&A, DeepSeek Search/Fetch, academic-source adapters, citations, local JSON storage, Electron installer.
