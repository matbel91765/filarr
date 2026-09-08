/**
 * InAppWiki — Filarr Notes
 *
 * Comprehensive searchable help & documentation modal.
 * Covers all 35+ features of the Notes knowledge management system.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { sanitizeHtml } from '../../../utils/sanitize';
import './InAppWiki.css';

// ==================== Wiki Topics ====================

interface WikiTopic {
  id: string;
  title: string;
  category: string;
  content: string;
}

function getWikiTopics(t: TFunction): WikiTopic[] {
  return [
    // ── Getting Started ──────────────────────────────────
    {
      id: 'getting-started',
      title: t('wiki.gettingStarted.title', 'Getting Started'),
      category: t('wiki.categories.gettingStarted', 'Getting Started'),
      content: t(
        'wiki.gettingStarted.content',
        "Welcome to **Filarr Notes** — your personal knowledge management system built right into Filarr.\n\n**Create your first note:** Click the **+** button in the Notes sidebar, or press `Ctrl+N`.\n\n**Write freely:** The editor supports rich text, markdown shortcuts, slash commands, and more. Just start typing.\n\n**Connect your knowledge:** Type `[[` to create wiki-links between notes, files, and folders. These connections build your personal knowledge graph.\n\n**Daily journaling:** Press `Ctrl+Shift+D` to create (or open) today's daily note — perfect for journaling, stand-ups, or daily logs.\n\n**Explore views:** Switch between List, Masonry, Kanban, Sticky Notes, Database, Tasks, Calendar, Mind Map and Graph views using the view toggle bar at the top."
      ),
    },
    {
      id: 'shortcuts',
      title: t('wiki.shortcuts.title', 'Keyboard Shortcuts'),
      category: t('wiki.categories.gettingStarted', 'Getting Started'),
      content: t(
        'wiki.shortcuts.content',
        "**Navigation:**\n- `Ctrl+N` — Create a new note\n- `Ctrl+Shift+D` — Open/create today's daily note\n- `Ctrl+Shift+G` — Toggle graph view\n- `Ctrl+P` — Open command palette\n\n**Text Formatting:**\n- `Ctrl+B` — Bold\n- `Ctrl+I` — Italic\n- `Ctrl+U` — Underline\n- `Ctrl+Shift+X` — Strikethrough\n- `Ctrl+Shift+H` — Highlight text\n\n**Editor Shortcuts:**\n- `/` — Open slash command menu\n- `[[` — Insert wiki-link with autocomplete\n- `#` at start of line — Heading (## for H2, ### for H3)\n- `-` or `*` at start — Bullet list\n- `1.` at start — Numbered list\n- `[]` at start — Task/checkbox\n- `>` at start — Blockquote\n- `---` — Horizontal rule\n- ` ``` ` — Code block"
      ),
    },
    {
      id: 'interface-overview',
      title: t('wiki.interfaceOverview.title', 'Interface Overview'),
      category: t('wiki.categories.gettingStarted', 'Getting Started'),
      content: t(
        'wiki.interfaceOverview.content',
        'The Notes interface is divided into three main areas:\n\n**Left Panel — Notes List:**\n- Browse, search, sort, and filter your notes\n- Create new notes, daily notes, or notes from templates\n- Pin important notes to keep them at the top\n- Access Flashcards, Templates, and this Wiki\n\n**Center — Editor:**\n- Rich text editor powered by TipTap\n- Floating bubble menu for quick formatting (select text to see it)\n- Toolbar at top with formatting, version history, and export\n- Breadcrumb trail showing recently visited notes\n- Slash commands (`/`) for inserting blocks\n\n**Right Panel — Backlinks & Smart Tags:**\n- See which notes link to the current one (backlinks)\n- Discover potential unlinked mentions\n- View outgoing links\n- Get AI-suggested tags based on content analysis'
      ),
    },

    // ── Editor ──────────────────────────────────────────
    {
      id: 'bubble-menu',
      title: t('wiki.bubbleMenu.title', 'Floating Bubble Menu'),
      category: t('wiki.categories.editor', 'Editor'),
      content: t(
        'wiki.bubbleMenu.content',
        "When you **select text** in the editor, a floating toolbar appears with quick formatting options:\n\n- **Bold**, **Italic**, **Underline**, **Strikethrough**\n- **Code** (inline monospace)\n- **Highlight** with color picker (8 colors available)\n- **Link** insertion\n\nThe bubble menu follows your selection and disappears when you click away. It's the fastest way to format text without leaving the keyboard."
      ),
    },
    {
      id: 'slash-commands',
      title: t('wiki.slashCommands.title', 'Slash Commands'),
      category: t('wiki.categories.editor', 'Editor'),
      content: t(
        'wiki.slashCommands.content',
        'Type `/` at the beginning of a new line to open the **slash command menu**. Available commands:\n\n**Text blocks:**\n- `/heading1`, `/heading2`, `/heading3` — Section headings\n- `/paragraph` — Normal text\n\n**Lists:**\n- `/bulletlist` — Unordered list\n- `/orderedlist` — Numbered list\n- `/tasklist` — Checkboxes / to-do list\n\n**Content:**\n- `/blockquote` — Quote block\n- `/codeblock` — Code with syntax highlighting\n- `/table` — Insert a table\n- `/horizontalrule` — Divider line\n- `/image` — Embed an image\n- `/file` — Embed a file from your library\n\nStart typing after `/` to filter commands. Press Enter or click to insert.'
      ),
    },
    {
      id: 'highlight-colors',
      title: t('wiki.highlightColors.title', 'Highlight Colors'),
      category: t('wiki.categories.editor', 'Editor'),
      content: t(
        'wiki.highlightColors.content',
        'Filarr Notes supports **multicolor highlighting** — perfect for color-coding different types of information.\n\n**How to use:**\n- Select text and click the highlight button in the bubble menu or toolbar\n- Choose from 8 preset colors: yellow, green, blue, purple, pink, red, orange, gray\n- Click the same color again to remove the highlight\n\n**Use cases:**\n- **Yellow** for key takeaways\n- **Green** for action items\n- **Blue** for references and sources\n- **Red** for warnings or critical items\n- **Purple** for ideas and brainstorming'
      ),
    },
    {
      id: 'drag-drop-blocks',
      title: t('wiki.dragDropBlocks.title', 'Drag & Drop Blocks'),
      category: t('wiki.categories.editor', 'Editor'),
      content: t(
        'wiki.dragDropBlocks.content',
        'Rearrange content blocks by dragging them:\n\n**How it works:**\n- Hover over any block (paragraph, heading, list, etc.) — a **drag handle** (6 dots) appears on the left\n- Click and hold the handle to start dragging\n- Drop the block at a new position — a blue insertion line shows where it will land\n\n**Supported blocks:**\n- Paragraphs, headings, blockquotes\n- Lists (entire list or individual items)\n- Code blocks, tables\n- Embedded files and images\n\nThis makes it easy to reorganize your notes without cutting and pasting.'
      ),
    },
    {
      id: 'editor-themes',
      title: t('wiki.editorThemes.title', 'Editor Themes'),
      category: t('wiki.categories.editor', 'Editor'),
      content: t(
        'wiki.editorThemes.content',
        "Customize the editor's look and feel with three built-in themes:\n\n**Default** — Clean, balanced design with the standard Filarr look.\n\n**Writer** — Optimized for long-form writing:\n- Serif font (Georgia) for comfortable reading\n- Warm cream-tinted background\n- Wider line spacing\n- Centered, narrower text column\n\n**Developer** — Designed for technical notes:\n- Monospace font (JetBrains Mono / Fira Code)\n- Dark-friendly styling\n- Better code block contrast\n\n**Switch themes:** Use the theme selector dropdown in the editor toolbar. Your choice persists across sessions."
      ),
    },

    // ── Links & Navigation ──────────────────────────────
    {
      id: 'wiki-links',
      title: t('wiki.wikiLinks.title', 'Wiki-Links'),
      category: t('wiki.categories.linksNavigation', 'Links & Navigation'),
      content: t(
        'wiki.wikiLinks.content',
        '**Wiki-links** are the core of the knowledge graph. They connect your notes bidirectionally.\n\n**Create a link:** Type `[[` and start typing a name. The autocomplete shows:\n- **Notes** — your existing notes\n- **Files** — documents in your library (use `[[file:document.pdf]]`)\n- **Folders** — your folder structure (use `[[folder:Projects]]`)\n\n**How links work:**\n- Clicking a wiki-link opens the linked note\n- `Ctrl+Click` opens the linked note in a split panel\n- Links are bidirectional — if Note A links to Note B, Note B shows a backlink to Note A\n\n**Link syntax:**\n- `[[Note Title]]` — Link to a note\n- `[[file:filename.pdf]]` — Link to a file\n- `[[folder:FolderName]]` — Link to a folder\n- `![[Note Title]]` — Embed (transclude) a note inline'
      ),
    },
    {
      id: 'backlinks',
      title: t('wiki.backlinks.title', 'Backlinks & Auto-Links'),
      category: t('wiki.categories.linksNavigation', 'Links & Navigation'),
      content: t(
        'wiki.backlinks.content',
        'The **Backlinks Panel** (right side of the editor) shows all connections to the current note:\n\n**Backlinks** — Notes that explicitly link to this note via `[[wiki-links]]`. Shows a context snippet around each mention.\n\n**Outgoing Links** — Notes, files, and folders that this note links to.\n\n**Potential Links** (Auto-detected) — Other notes that mention this note\'s title in their text but haven\'t created an explicit link yet. Click the "+" to convert a mention into a link.\n\n**Orphan Detection** — Notes with no incoming or outgoing links are flagged with an orange "unlinked" badge in the notes list, helping you discover disconnected knowledge.'
      ),
    },
    {
      id: 'transclusion',
      title: t('wiki.transclusion.title', 'Transclusion (Note Embedding)'),
      category: t('wiki.categories.linksNavigation', 'Links & Navigation'),
      content: t(
        'wiki.transclusion.content',
        '**Transclusion** lets you embed the content of one note inside another.\n\n**Syntax:** Use `![[Note Title]]` (note the exclamation mark before the brackets).\n\n**What happens:**\n- The referenced note\'s content appears inline as a bordered, read-only card\n- The embedded content updates live — edit the source note and the transclusion refreshes\n- Click the transclusion to navigate to the source note\n\n**Use cases:**\n- Create a "dashboard" note that aggregates sections from multiple notes\n- Reuse definitions, templates, or reference material across notes\n- Build a master document from modular components'
      ),
    },
    {
      id: 'breadcrumb',
      title: t('wiki.breadcrumb.title', 'Breadcrumb Navigation'),
      category: t('wiki.categories.linksNavigation', 'Links & Navigation'),
      content: t(
        'wiki.breadcrumb.content',
        'The **breadcrumb trail** appears above the editor, showing the last notes you visited.\n\n- Up to **10 recent notes** are tracked\n- Click any breadcrumb to jump back to that note\n- The trail resets to the current note when you navigate\n- Useful for quickly switching between related notes you\'re working on\n\nThe breadcrumb is your "back" button for note navigation — no need to search for notes you just had open.'
      ),
    },
    {
      id: 'hover-preview',
      title: t('wiki.hoverPreview.title', 'Link Preview on Hover'),
      category: t('wiki.categories.linksNavigation', 'Links & Navigation'),
      content: t(
        'wiki.hoverPreview.content',
        'Hover over any `[[wiki-link]]` in the editor to see a **preview popover** without leaving the current note.\n\nThe preview shows:\n- Note title\n- First ~150 characters of the note content\n- Word count and link count\n- Last updated date\n\nThis lets you quickly check what a linked note contains before deciding to navigate to it.'
      ),
    },
    {
      id: 'split-editing',
      title: t('wiki.splitEditing.title', 'Split Note Editing'),
      category: t('wiki.categories.linksNavigation', 'Links & Navigation'),
      content: t(
        'wiki.splitEditing.content',
        "Open two notes side by side:\n\n**How:** Hold `Ctrl` and click a wiki-link. The linked note opens in a new panel to the right.\n\nThis uses Filarr's tab system — you can have multiple notes open in separate tabs and split panels.\n\n**Use cases:**\n- Compare two notes\n- Reference material while writing\n- Copy content between notes\n- Review linked notes without losing your place"
      ),
    },

    // ── Views ──────────────────────────────────────────
    {
      id: 'list-view',
      title: t('wiki.listView.title', 'List View'),
      category: t('wiki.categories.views', 'Views'),
      content: t(
        'wiki.listView.content',
        'The default view — a traditional **sidebar + editor** layout.\n\n**Left sidebar shows:**\n- All notes sorted by date, title, or word count\n- Search bar to filter notes instantly\n- Sort controls (Modified, Title, Created, Words) with ascending/descending toggle\n- Note count\n- Pinned notes appear at the top\n\n**Right side:** The full editor with toolbar, bubble menu, and backlinks panel.\n\n**Tip:** Pin frequently accessed notes to keep them at the top of the list regardless of sort order.'
      ),
    },
    {
      id: 'masonry-view',
      title: t('wiki.masonryView.title', 'Masonry View'),
      category: t('wiki.categories.views', 'Views'),
      content: t(
        'wiki.masonryView.content',
        '**Pinterest-style card grid** showing all your notes as cards.\n\nEach card displays:\n- Note title\n- First ~100 characters of content preview\n- Word count and link count\n- Cover color (if set)\n- Daily note badge\n\nCards are arranged in a responsive masonry layout that fills available space. Click any card to open it in the editor.\n\n**Best for:** Visual overview of all notes, quickly scanning content, finding notes by appearance.'
      ),
    },
    {
      id: 'kanban-view',
      title: t('wiki.kanbanView.title', 'Kanban View'),
      category: t('wiki.categories.views', 'Views'),
      content: t(
        'wiki.kanbanView.content',
        'Organize notes into **columns** — perfect for project management and workflows.\n\n**Default columns:** Inbox, In Progress, Review, Done.\n\n**Features:**\n- **Drag & drop** notes between columns to change their status\n- **Add columns** — click "+" to create custom columns\n- **Delete columns** — hover a column header and click the trash icon\n- Notes are automatically saved to their column\n\n**How it works internally:** The column assignment is stored in the note\'s metadata, so moving between columns is instant.\n\n**Best for:** Project tracking, content pipelines, task management, sprint planning.'
      ),
    },
    {
      id: 'sticky-notes-view',
      title: t('wiki.stickyNotesView.title', 'Sticky Notes View'),
      category: t('wiki.categories.views', 'Views'),
      content: t(
        'wiki.stickyNotesView.content',
        'A **free-form 2D canvas** where notes appear as colored sticky notes.\n\n**Controls:**\n- **Drag** a sticky note to reposition it\n- **Scroll wheel** to zoom in/out\n- **Shift+click** and drag on the background to pan the canvas\n- Notes snap to a 20px grid for clean alignment\n\n**Colors:** Each note gets a color from the palette (yellow, green, blue, purple, pink, orange). Colors cycle automatically.\n\n**Best for:** Brainstorming, mind mapping, spatial organization, visual thinkers.'
      ),
    },

    // ── Graph ──────────────────────────────────────────
    {
      id: 'graph-view',
      title: t('wiki.graphView.title', 'Graph View'),
      category: t('wiki.categories.graph', 'Graph'),
      content: t(
        'wiki.graphView.content',
        'The **Graph View** visualizes your knowledge as an interactive network.\n\n**Node types:**\n- **Circles** (blue) = Notes\n- **Squares** (green) = Files\n- **Hexagons** (yellow) = Folders\n\n**Node size** reflects how many connections each item has.\n\n**Interactions:**\n- **Click** a node to select and open it\n- **Drag** nodes to rearrange the layout\n- **Scroll** to zoom in/out\n- **Click + drag** on empty space to pan\n\n**Edge types:**\n- Solid lines = note-to-note links\n- Dashed lines = note-to-file or note-to-folder links\n\nThe graph uses a real-time **force-directed layout** — nodes repel each other and edges pull connected nodes together.'
      ),
    },
    {
      id: 'graph-clusters',
      title: t('wiki.graphClusters.title', 'Automatic Clusters'),
      category: t('wiki.categories.graph', 'Graph'),
      content: t(
        'wiki.graphClusters.content',
        "Enable **Clusters** to automatically group densely connected notes.\n\n**How it works:**\n- Uses a simplified **Louvain algorithm** for community detection\n- Notes that are heavily interconnected form a cluster\n- Each cluster gets a unique color\n- A legend shows all clusters with their colors\n\n**Toggle:** Click the cluster icon in the graph toolbar (top-left, three-circle icon).\n\n**Insights:** Clusters reveal hidden structure in your knowledge — topics you've written about extensively tend to form tight groups. Isolated clusters might indicate disconnected areas worth bridging."
      ),
    },
    {
      id: 'graph-heatmap',
      title: t('wiki.graphHeatmap.title', 'Heat Map Mode'),
      category: t('wiki.categories.graph', 'Graph'),
      content: t(
        'wiki.graphHeatmap.content',
        'Toggle the **heat map** to visualize note recency.\n\n**Color coding:**\n- **Red/Hot** — Recently edited notes (today/yesterday)\n- **Yellow/Warm** — Edited this week\n- **Blue/Cold** — Older, stale notes\n\n**Toggle:** Click the flame/pin icon in the graph toolbar.\n\n**Insights:** The heat map reveals which parts of your knowledge base are actively maintained and which areas might need revisiting. Cold clusters are opportunities for review.\n\nNote: Clusters and Heat Map are mutually exclusive — enabling one disables the other.'
      ),
    },
    {
      id: 'graph-filter',
      title: t('wiki.graphFilter.title', 'Graph Filter'),
      category: t('wiki.categories.graph', 'Graph'),
      content: t(
        'wiki.graphFilter.content',
        "Use the **search bar** in the graph toolbar to filter nodes by title.\n\n**How it works:**\n- Type a search term in the filter input\n- Matching nodes remain fully visible\n- Non-matching nodes fade to 12% opacity (they're still there, just dimmed)\n- Edges to dimmed nodes also fade\n\n**Use cases:**\n- Focus on a specific topic area\n- Find where a particular note sits in your knowledge graph\n- Explore the neighborhood of a specific node"
      ),
    },
    {
      id: 'graph-time-travel',
      title: t('wiki.graphTimeTravel.title', 'Time Travel'),
      category: t('wiki.categories.graph', 'Graph'),
      content: t(
        'wiki.graphTimeTravel.content',
        'The **Time Travel** slider lets you see your knowledge graph as it was at any point in time.\n\n**How to use:**\n- Click the clock icon in the graph toolbar to enable time travel\n- A slider appears below the toolbar\n- Drag the slider to scrub through time\n- Notes created after the selected date are hidden\n- The current date is displayed next to the slider\n\n**Use cases:**\n- See how your knowledge base has grown over time\n- Review what you knew at a specific point\n- Identify when connections were formed'
      ),
    },

    // ── Templates & Daily Notes ──────────────────────────
    {
      id: 'templates',
      title: t('wiki.templates.title', 'Templates'),
      category: t('wiki.categories.templatesDaily', 'Templates & Daily'),
      content: t(
        'wiki.templates.content',
        '**Templates** provide pre-structured content for common note types.\n\n**Built-in templates:**\n- **Meeting Notes** — Attendees, agenda, decisions, action items\n- **Decision Log** — Context, options considered, decision, rationale\n- **Weekly Review** — Accomplishments, challenges, next week\'s goals\n- **Brainstorm** — Topic, ideas, evaluation, next steps\n\n**Using a template:** Open the Template Manager (grid icon in the sidebar), browse templates, and click "Use Template".\n\n**Custom templates:** Open any note, then click "Save as Template" at the bottom of the sidebar. Your note\'s content becomes a reusable template.\n\n**Variables:** Templates support `{{date}}`, `{{title}}`, and other placeholders that are automatically filled when you create a note from the template.'
      ),
    },
    {
      id: 'daily-notes',
      title: t('wiki.dailyNotes.title', 'Daily Notes'),
      category: t('wiki.categories.templatesDaily', 'Templates & Daily'),
      content: t(
        'wiki.dailyNotes.content',
        '**Daily notes** are automatically dated journal entries — one per day.\n\n**Create:** Press `Ctrl+Shift+D` or click the calendar icon in the sidebar.\n\n**Naming:** Daily notes use the format "YYYY-MM-DD" (e.g., "2026-03-14").\n\n**Smart carry-over:** When you create a new daily note, any **unchecked tasks** from the previous day\'s note are automatically carried over to the new note under a "Carried Over" heading. This ensures nothing falls through the cracks.\n\n**Badge:** Daily notes have a calendar icon badge in the notes list to distinguish them from regular notes.\n\n**Best for:** Daily journals, stand-up notes, work logs, habit tracking.'
      ),
    },

    // ── Organization ──────────────────────────────────
    {
      id: 'pinning',
      title: t('wiki.pinning.title', 'Pinning Notes'),
      category: t('wiki.categories.organization', 'Organization'),
      content: t(
        'wiki.pinning.content',
        '**Pin** important notes to keep them at the top of the sidebar, regardless of sort order.\n\n**How:** Click the pin icon on any note card, or right-click and select "Pin".\n\nPinned notes have a subtle pin badge and are always visible at the top of the list. This is useful for:\n- Quick access to frequently referenced notes\n- Keeping project dashboards visible\n- Marking notes you\'re actively working on'
      ),
    },
    {
      id: 'sorting-searching',
      title: t('wiki.sortingSearching.title', 'Sorting & Searching'),
      category: t('wiki.categories.organization', 'Organization'),
      content: t(
        'wiki.sortingSearching.content',
        '**Search:** The search bar at the top of the sidebar filters notes instantly as you type. It searches both titles and content.\n\n**Sort options** (click the sort icon to cycle):\n- **Modified** — Most recently edited first (default)\n- **Title** — Alphabetical order\n- **Created** — Newest notes first\n- **Words** — Longest notes first\n\n**Sort order:** Click the arrow (up/down) to toggle ascending/descending.\n\n**Note count:** The total number of matching notes is shown next to the sort controls.'
      ),
    },
    {
      id: 'smart-tags',
      title: t('wiki.smartTags.title', 'Smart Tags (AI Suggestions)'),
      category: t('wiki.categories.organization', 'Organization'),
      content: t(
        'wiki.smartTags.content',
        'Filarr uses **TF-IDF analysis** to automatically suggest relevant tags for your notes.\n\n**How it works:**\n- The algorithm analyzes the text of all your notes\n- It finds keywords that are **distinctive** to each note (common words across all notes are de-prioritized)\n- The top 5 keyword suggestions appear below the Backlinks panel\n- Supports both **English and French** stop word filtering\n\n**Adding a tag:** Click the "+" button next to any suggestion to create and apply the tag to your note.\n\n**TF-IDF explained:** Term Frequency-Inverse Document Frequency is a statistical measure that evaluates how important a word is to a document in a collection. Words that appear frequently in one note but rarely in others get higher scores.'
      ),
    },
    {
      id: 'orphan-detection',
      title: t('wiki.orphanDetection.title', 'Orphan Detection'),
      category: t('wiki.categories.organization', 'Organization'),
      content: t(
        'wiki.orphanDetection.content',
        "**Orphan notes** are notes with no incoming or outgoing wiki-links — they're disconnected from your knowledge graph.\n\n**Identification:** Orphan notes display an orange dot badge in the notes list.\n\n**Why it matters:** Orphaned notes represent knowledge that isn't connected to anything else. You might want to:\n- Add wiki-links to connect them to related notes\n- Check if they contain useful information worth linking\n- Delete them if they're no longer needed\n\n**Backlinks Panel:** When viewing an orphan note, the backlinks panel shows \"No connections\" and suggests creating links."
      ),
    },
    {
      id: 'folder-notes',
      title: t('wiki.folderNotes.title', 'Notes in Folders'),
      category: t('wiki.categories.organization', 'Organization'),
      content: t(
        'wiki.folderNotes.content',
        'Notes can be **associated with folders** in your file system, appearing alongside your files.\n\nWhen notes are linked to a folder, they show up as compact cards in the Folder View, below the files section.\n\n**Click** a note card in the folder view to open it in the Notes editor.\n\nThis bridges the gap between your document library and your knowledge system — meeting notes can live next to meeting files, project notes next to project documents.'
      ),
    },

    // ── Version History & Export ──────────────────────
    {
      id: 'versioning',
      title: t('wiki.versioning.title', 'Version History'),
      category: t('wiki.categories.historyExport', 'History & Export'),
      content: t(
        'wiki.versioning.content',
        'Filarr automatically saves **version snapshots** of your notes as you edit.\n\n**How it works:**\n- Snapshots are taken every **30 seconds** (minimum interval between versions)\n- Up to **20 versions** are kept per note (oldest are pruned)\n- Each version stores the full content, title, and word count\n\n**Viewing history:** Click the **clock icon** in the editor toolbar to open the Version History panel.\n\n**Features:**\n- **Timeline** — Browse all saved versions with timestamps\n- **Diff view** — Click "Show Diff" to see what changed between two versions (green = added, red = removed)\n- **Restore** — Click "Restore" on any version to revert the note to that state\n\n**Storage:** Versions are stored locally in your profile storage — they persist across sessions.'
      ),
    },
    {
      id: 'export',
      title: t('wiki.export.title', 'Multi-Format Export'),
      category: t('wiki.categories.historyExport', 'History & Export'),
      content: t(
        'wiki.export.content',
        "Export your notes in five formats:\n\n**Markdown (.md)** — Clean plain text with formatting. Perfect for sharing, publishing, or migrating to other tools.\n\n**HTML (.html)** — Fully styled web page. Includes Filarr's typography and can be opened in any browser.\n\n**PDF (.pdf)** — Portable document. Good for printing or sharing formal documents.\n\n**DOCX (.docx)** — Microsoft Word format. Ideal for collaboration with people who use Word.\n\n**Filarr (.filarr)** — Complete backup including all metadata, wiki-links, tags, and version history. Use this for full backups or transferring between Filarr installations.\n\n**How to export:** Click the **download icon** in the editor toolbar to open the Export dialog. Choose your format, toggle options (include metadata, include links), and click Export."
      ),
    },

    // ── Learning ──────────────────────────────────────
    {
      id: 'flashcards',
      title: t('wiki.flashcards.title', 'Flashcards'),
      category: t('wiki.categories.learning', 'Learning'),
      content: t(
        'wiki.flashcards.content',
        'Create **flashcards** from your notes for spaced repetition learning.\n\n**Adding Q&A pairs:** Write questions and answers in your notes using these formats:\n\n`Q: What is a wiki-link?`\n`A: A bidirectional link between notes using [[brackets]]`\n\nOr the shorter format:\n`? Question here`\n`! Answer here`\n\n**Generating a deck:** Open the Flashcard view (card icon in the sidebar header), then click "Generate from Notes" to scan all your notes for Q&A pairs.\n\n**Reviewing:**\n- Cards show the question first\n- Click "Reveal" to see the answer\n- Rate your recall: Again, Hard, Good, or Easy\n- The **SM-2 algorithm** schedules cards for optimal review intervals\n\n**Spaced repetition:** Cards you find easy are shown less frequently. Cards you struggle with are shown more often. This scientifically optimizes your learning.'
      ),
    },

    // ── Advanced ──────────────────────────────────────
    {
      id: 'file-embed',
      title: t('wiki.fileEmbed.title', 'File & Image Embedding'),
      category: t('wiki.categories.advanced', 'Advanced'),
      content: t(
        'wiki.fileEmbed.content',
        "Embed files and images directly in your notes.\n\n**Methods:**\n- Use the slash command `/image` or `/file`\n- Drag and drop a file from the Filarr file explorer into the editor\n\n**Supported previews:**\n- **Images** (PNG, JPG, GIF, SVG) — inline image preview\n- **Videos** (MP4, WebM) — video player\n- **Documents** (PDF, DOCX, etc.) — file card with icon and name\n\n**File cards** show the file name, type icon, and size. Click a file card to open it in Filarr's file viewer.\n\nThis lets you create rich notes that combine text with visual and document references."
      ),
    },
    {
      id: 'markdown-shortcuts',
      title: t('wiki.markdownShortcuts.title', 'Markdown Shortcuts'),
      category: t('wiki.categories.advanced', 'Advanced'),
      content: t(
        'wiki.markdownShortcuts.content',
        'The editor recognizes common **Markdown syntax** and converts it to rich text automatically:\n\n- `# Heading 1`, `## Heading 2`, `### Heading 3`\n- `**bold**` \u2192 **bold**\n- `*italic*` \u2192 *italic*\n- `~~strikethrough~~` \u2192 ~~strikethrough~~\n- `==highlight==` \u2192 highlighted text\n- `\\`code\\`` \u2192 inline code\n- `- item` or `* item` \u2192 bullet list\n- `1. item` \u2192 numbered list\n- `[] task` \u2192 task checkbox\n- `> quote` \u2192 blockquote\n- `---` \u2192 horizontal rule\n- `\\`\\`\\`` \u2192 code block\n\nThese shortcuts work inline as you type — no need to switch modes. The text is converted to rich content immediately.'
      ),
    },
    {
      id: 'full-text-search',
      title: t('wiki.fullTextSearch.title', 'Full-Text Search'),
      category: t('wiki.categories.advanced', 'Advanced'),
      content: t(
        'wiki.fullTextSearch.content',
        "Filarr Notes uses **FlexSearch** for instant full-text search across all your notes.\n\n**Features:**\n- Search by content, title, or both\n- Results appear as you type with highlighted snippets\n- Prefix queries: type `title:keyword` to search only in titles\n- Handles thousands of notes with sub-millisecond response times\n\n**Where it's used:**\n- The search bar in the Notes sidebar\n- Wiki-link autocomplete (`[[`)\n- Command palette\n\n**Technical details:** The search index is built in-memory from your Redux store and updates automatically as you create, edit, or delete notes. It uses tokenized indexing for fast fuzzy matching."
      ),
    },
    {
      id: 'tips',
      title: t('wiki.tips.title', 'Tips & Best Practices'),
      category: t('wiki.categories.advanced', 'Advanced'),
      content: t(
        'wiki.tips.content',
        "**Build connections gradually.** Don't worry about creating the perfect structure upfront. Add wiki-links as you write, and the graph will emerge naturally.\n\n**Use daily notes as an inbox.** Capture thoughts in your daily note, then refine and link them to permanent notes later.\n\n**Review orphans regularly.** Check the orphan badges in your notes list — these are notes that could benefit from connections.\n\n**Use templates for recurring notes.** Meeting notes, weekly reviews, and project logs are perfect candidates for templates.\n\n**Leverage the graph.** Switch to Graph View periodically to discover unexpected connections and identify knowledge gaps.\n\n**Export for backup.** Use the Filarr (.filarr) export format periodically for a complete backup of your knowledge base with all metadata intact.\n\n**Keyboard-first workflow.** Learn `Ctrl+N`, `Ctrl+Shift+D`, `/`, and `[[` — these four shortcuts cover 90% of note creation and linking."
      ),
    },
  ];
}

// ==================== Icons ====================

const BookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// ==================== Component ====================

interface InAppWikiProps {
  onClose: () => void;
}

export const InAppWiki: React.FC<InAppWikiProps> = React.memo(function InAppWiki({ onClose }) {
  const { t } = useTranslation();
  const wikiTopics = useMemo(() => getWikiTopics(t), [t]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('getting-started');

  const filteredTopics = useMemo(() => {
    if (!searchQuery.trim()) return wikiTopics;
    const q = searchQuery.toLowerCase();
    return wikiTopics.filter(
      (topic) => topic.title.toLowerCase().includes(q) || topic.content.toLowerCase().includes(q)
    );
  }, [searchQuery, wikiTopics]);

  const selectedTopic = wikiTopics.find((tp) => tp.id === selectedTopicId) || wikiTopics[0];

  // Group by category
  const categories = useMemo(() => {
    const map = new Map<string, WikiTopic[]>();
    for (const topic of filteredTopics) {
      const list = map.get(topic.category) || [];
      list.push(topic);
      map.set(topic.category, list);
    }
    return map;
  }, [filteredTopics]);

  // Render markdown-like content with better parsing
  const renderContent = useCallback((content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inList = false;
    let listItems: React.ReactNode[] = [];
    let listKey = 0;

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`list-${listKey++}`} className="wiki__list">
            {listItems}
          </ul>
        );
        listItems = [];
        inList = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Apply inline formatting
      const formatted = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>');

      // List items
      if (line.startsWith('- ')) {
        inList = true;
        listItems.push(
          <li key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(formatted.slice(2)) }} />
        );
        continue;
      }

      // Flush pending list before non-list content
      if (inList) flushList();

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={i} className="wiki__spacer" />);
        continue;
      }

      // Regular paragraph
      elements.push(<p key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(formatted) }} />);
    }

    // Flush remaining list
    flushList();

    return elements;
  }, []);

  return (
    <div className="wiki-overlay" onClick={onClose}>
      <div className="wiki" onClick={(e) => e.stopPropagation()}>
        <div className="wiki__header">
          <BookIcon />
          <h3>{t('notes.wiki', 'Help & Documentation')}</h3>
          <span className="wiki__topic-count">
            {wikiTopics.length} {t('notes.wikiTopics', 'topics')}
          </span>
          <button className="wiki__close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="wiki__body">
          {/* Sidebar */}
          <div className="wiki__sidebar">
            <div className="wiki__search">
              <SearchIcon />
              <input
                className="wiki__search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('notes.searchWiki', 'Search topics...')}
                autoFocus
              />
              {searchQuery && (
                <button className="wiki__search-clear" onClick={() => setSearchQuery('')}>
                  &times;
                </button>
              )}
            </div>
            <div className="wiki__topics">
              {filteredTopics.length === 0 ? (
                <div className="wiki__no-results">
                  {t('notes.wikiNoResults', 'No matching topics')}
                </div>
              ) : (
                Array.from(categories).map(([category, topics]) => (
                  <div key={category} className="wiki__category">
                    <div className="wiki__category-title">{category}</div>
                    {topics.map((topic) => (
                      <button
                        key={topic.id}
                        className={`wiki__topic ${topic.id === selectedTopicId ? 'is-active' : ''}`}
                        onClick={() => setSelectedTopicId(topic.id)}
                      >
                        {topic.title}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Content */}
          <div className="wiki__content">
            <div className="wiki__content-header">
              <span className="wiki__content-category">{selectedTopic.category}</span>
            </div>
            <h2 className="wiki__content-title">{selectedTopic.title}</h2>
            <div className="wiki__content-body">{renderContent(selectedTopic.content)}</div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default InAppWiki;
