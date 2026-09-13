# Visual Repository Planner

Drag your repository into the layout you wish it had, then export a `git mv`
script that makes it real — plus a prompt that gets an agent to fix every import.

Consolidation of two AI Studio projects (`workspace-builder` and
`workspace-builder-2`), which were the same app at two stages rather than two
different apps.

## The loop

1. **Open a folder.** Reads the directory off disk — structure only, file bodies
   stay behind their handles until you click one. `node_modules`, `.git`, build
   output and lockfiles are skipped.
2. **Rearrange it.** Drag rows, rename, add, delete. Changed paths tint in the
   tree. `⌘Z` / `⇧⌘Z` undo and redo. Nothing on disk is touched.
3. **Export.** A runnable bash script (`mkdir -p`, `git mv`, `rm`) and a
   structured prompt listing every path that moved, for updating imports
   afterwards.

The copilot pane is optional help for step 2: ask for a layout change, get a
batch of proposed changes, apply the batch as one undoable step.

Sign-in is optional and nothing gates on it. Signed in, your planned layout
follows you between machines; signed out, everything above still works.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
```

`GEMINI_API_KEY` enables the copilot. Without it the copilot returns a clear
error and the rest of the app is unaffected.

```bash
npm test         # vitest
npm run lint     # tsc --noEmit
npm run build    # client bundle + bundled server
```

## Layout

```
server.ts                  Express: /api/plan (Gemini) + serves the SPA
src/
  store/
    treeOps.ts             path-addressed tree mutations, structural sharing
    contentStore.ts        file bodies, deliberately outside React state
    useRepoStore.ts        zustand store: tree, selection, undo, persistence
  utils/
    fileSystem.ts          directory ingest (File System Access API + fallback)
    diffUtils.ts           baseline-vs-current diff, script + prompt exporters
  components/
    RepoViewer.tsx         toolbar, search, virtualised tree
    TreeRow.tsx            one row
    FilePreview.tsx        CodeMirror pane
    CopilotChat.tsx        copilot, batch diff proposals
    DiffCard.tsx           the +/- proposal card
    BundleChangesModal.tsx export dialog
    CodeView.tsx           lazily-loaded CodeMirror wrapper
  lib/
    auth.ts                optional Google sign-in, dynamically imported
    persistence.ts         debounced, structure-only Firestore sync
```

## Decisions worth knowing

These are the things most likely to be undone by accident.

**File content is not on the tree node.** It lives in `contentStore`, outside
React state, and the editor writes through to it directly. Putting `content`
back on `FileNode` means every keystroke clones the tree and queues a network
write. `writeFileContent` deliberately does not bump `contentVersion`, so typing
never remounts the editor — there are tests asserting exactly this.

**Mutations share structure.** `addPath` / `removePath` / `movePath` copy only
the spine from the root to the changed node; untouched subtrees keep their
identity so `TreeRow`'s memo can skip them. A `JSON.parse(JSON.stringify(tree))`
anywhere in a mutation path undoes this.

**Bulk ingest uses `buildTreeFromPaths`, not repeated `addPath`.** One insert at
a time is quadratic when a folder holds thousands of direct children — building
a 20k-file folder that way took minutes. There is a timing test guarding it.

**Nodes are paired by `id`, not path.** That is what makes a drag export as
`git mv` (history follows the file) instead of a delete plus an add.

**Added paths do not collapse in the export.** Moves and deletes do: `git mv`
and `rm -rf` carry a folder's children along. Adds do not, because `mkdir -p`
creates a directory and nothing inside it — collapsing them exported an empty
folder.

**Mantine styles are imported per component** in `src/main.tsx`, not as the
whole bundle (~5× the CSS). Adding a new Mantine component means adding its
CSS import there, or it renders unstyled.

**Firebase and CodeMirror are dynamically imported.** Neither is needed to open
a folder and look at it, and together they were most of the entry bundle.

**`vitest` is pinned exactly.** A caret range resolves to a version whose peer
graph crashes `npm install` on npm 10 (`Cannot read properties of null (reading
'edgesOut')`). Widen it only after checking that a clean install still works.

## Persistence and data

Only the tree *structure* is synced, never file contents. Writes are debounced
and coalesced, and failures are surfaced in the header rather than logged and
forgotten. `firestore.rules` caps the document at 1 MiB; `persistence.ts` checks
against that before writing and tells the user instead of failing at the server.

The key in `firebase-applet-config.json` is a public client identifier, not a
secret — Firebase web API keys are meant to be shipped. `firestore.rules` is
what actually guards the data, and it scopes every document to its owner.
