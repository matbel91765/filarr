/**
 * Starter Templates — Filarr Onboarding
 *
 * Provides folder structures, tags, and welcome note content
 * tailored to 4 use cases: Personal, Student, Professional, Creative.
 * All text uses i18n keys resolved at creation time.
 */

// ==================== TYPES ====================

export type UseCase = 'personal' | 'student' | 'professional' | 'creative';

export interface FolderTemplate {
  nameKey: string;
  color: string;
  children?: FolderTemplate[];
}

export interface TagTemplate {
  nameKey: string;
  color: string;
  icon?: string;
}

export interface StarterTemplate {
  folders: FolderTemplate[];
  tags: TagTemplate[];
}

// ==================== USE CASE OPTIONS ====================

export interface UseCaseOption {
  id: UseCase;
  titleKey: string;
  descriptionKey: string;
  icon: string;
}

export const USE_CASE_OPTIONS: UseCaseOption[] = [
  {
    id: 'personal',
    titleKey: 'onboarding.useCase.personalTitle',
    descriptionKey: 'onboarding.useCase.personalDesc',
    icon: '🏠',
  },
  {
    id: 'student',
    titleKey: 'onboarding.useCase.studentTitle',
    descriptionKey: 'onboarding.useCase.studentDesc',
    icon: '🎓',
  },
  {
    id: 'professional',
    titleKey: 'onboarding.useCase.professionalTitle',
    descriptionKey: 'onboarding.useCase.professionalDesc',
    icon: '💼',
  },
  {
    id: 'creative',
    titleKey: 'onboarding.useCase.creativeTitle',
    descriptionKey: 'onboarding.useCase.creativeDesc',
    icon: '🎨',
  },
];

// ==================== STARTER TEMPLATES ====================

export const STARTER_TEMPLATES: Record<UseCase, StarterTemplate> = {
  personal: {
    folders: [
      {
        nameKey: 'onboarding.folders.documents',
        color: '#3b82f6',
        children: [{ nameKey: 'onboarding.folders.invoices', color: '#3b82f6' }],
      },
      { nameKey: 'onboarding.folders.photosMedia', color: '#8b5cf6' },
      { nameKey: 'onboarding.folders.admin', color: '#ef4444' },
      { nameKey: 'onboarding.folders.health', color: '#10b981' },
      { nameKey: 'onboarding.folders.travel', color: '#f97316' },
    ],
    tags: [
      { nameKey: 'onboarding.tags.important', color: '#ef4444' },
      { nameKey: 'onboarding.tags.toRead', color: '#3b82f6' },
      { nameKey: 'onboarding.tags.personal', color: '#8b5cf6' },
    ],
  },
  student: {
    folders: [
      {
        nameKey: 'onboarding.folders.courses',
        color: '#3b82f6',
        children: [{ nameKey: 'onboarding.folders.semester1', color: '#3b82f6' }],
      },
      { nameKey: 'onboarding.folders.projects', color: '#8b5cf6' },
      { nameKey: 'onboarding.folders.research', color: '#10b981' },
      { nameKey: 'onboarding.folders.internship', color: '#f97316' },
      { nameKey: 'onboarding.folders.exams', color: '#ef4444' },
    ],
    tags: [
      { nameKey: 'onboarding.tags.urgent', color: '#ef4444' },
      { nameKey: 'onboarding.tags.toReview', color: '#f97316' },
      { nameKey: 'onboarding.tags.due', color: '#3b82f6' },
    ],
  },
  professional: {
    folders: [
      { nameKey: 'onboarding.folders.clients', color: '#3b82f6' },
      {
        nameKey: 'onboarding.folders.projects',
        color: '#8b5cf6',
        children: [{ nameKey: 'onboarding.folders.year2026', color: '#8b5cf6' }],
      },
      { nameKey: 'onboarding.folders.invoicesQuotes', color: '#10b981' },
      { nameKey: 'onboarding.folders.contracts', color: '#f97316' },
      { nameKey: 'onboarding.folders.archives', color: '#64748b' },
    ],
    tags: [
      { nameKey: 'onboarding.tags.inProgress', color: '#3b82f6' },
      { nameKey: 'onboarding.tags.urgent', color: '#ef4444' },
      { nameKey: 'onboarding.tags.validated', color: '#10b981' },
    ],
  },
  creative: {
    folders: [
      { nameKey: 'onboarding.folders.inspirations', color: '#ec4899' },
      { nameKey: 'onboarding.folders.projects', color: '#8b5cf6' },
      { nameKey: 'onboarding.folders.portfolio', color: '#3b82f6' },
      {
        nameKey: 'onboarding.folders.assets',
        color: '#10b981',
        children: [{ nameKey: 'onboarding.folders.fonts', color: '#10b981' }],
      },
      { nameKey: 'onboarding.folders.drafts', color: '#64748b' },
    ],
    tags: [
      { nameKey: 'onboarding.tags.idea', color: '#f59e0b' },
      { nameKey: 'onboarding.tags.inProgress', color: '#3b82f6' },
      { nameKey: 'onboarding.tags.finished', color: '#10b981' },
    ],
  },
};

// ==================== WELCOME NOTE ====================

export function getWelcomeNoteContent(lang: 'en' | 'fr', firstFolderName: string): string {
  if (lang === 'fr') {
    return JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Bienvenue dans Filarr' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Filarr est votre gestionnaire de fichiers ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'local-first' },
            { type: 'text', text: ' et ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'chiffre' },
            {
              type: 'text',
              text: '. Tout reste sur votre appareil — aucune donnee ne transite par un serveur.',
            },
          ],
        },

        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Fonctionnalites principales' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Dossiers intelligents' },
                    {
                      type: 'text',
                      text: ' — Organisez avec des couleurs, des descriptions et des tags',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Notes connectees' },
                    {
                      type: 'text',
                      text: ' — Editeur riche avec wiki-links, checklists, tableaux, dessins et code',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Graph View' },
                    {
                      type: 'text',
                      text: ' — Visualisez les connexions entre vos notes et fichiers',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Collections' },
                    {
                      type: 'text',
                      text: ' — Regroupez des elements de differents dossiers par tags ou regles',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Automatisation' },
                    {
                      type: 'text',
                      text: ' — Creez des regles pour trier, renommer et taguer automatiquement',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Chiffrement AES-256-GCM' },
                    { type: 'text', text: ' — Protegez vos fichiers avec un mot de passe maitre' },
                  ],
                },
              ],
            },
          ],
        },

        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Syntaxe Wiki-Links' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Tapez [[ pour creer un lien vers une autre note, un fichier ou un dossier :',
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: '[[Nom de la note]]' },
                    { type: 'text', text: ' — Lien vers une note' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: '[[file:rapport.pdf]]' },
                    { type: 'text', text: ' — Lien vers un fichier' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: '[[folder:Projets]]' },
                    { type: 'text', text: ' — Lien vers un dossier' },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Les liens apparaissent dans le Graph View et dans le panneau Backlinks de chaque note.',
            },
          ],
        },

        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Mise en forme' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: "L'editeur supporte toute la syntaxe riche :" }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Gras' },
                    { type: 'text', text: ', ' },
                    { type: 'text', marks: [{ type: 'italic' }], text: 'Italique' },
                    { type: 'text', text: ', ' },
                    { type: 'text', marks: [{ type: 'strike' }], text: 'Barre' },
                    { type: 'text', text: ', ' },
                    { type: 'text', marks: [{ type: 'underline' }], text: 'Souligne' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Titres H1, H2, H3' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Listes a puces, numerotees et checklists' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Blocs de code avec coloration syntaxique' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Citations, tableaux, separateurs' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Surlignage couleur et dessins' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Tapez / pour ouvrir le menu de commandes rapides dans une note.',
            },
          ],
        },

        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: `Votre premier dossier : [[${firstFolderName}]]` }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Cliquez sur le lien ci-dessus pour acceder a votre premier dossier. Vous pouvez y glisser-deposer des fichiers directement.',
            },
          ],
        },

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A faire' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Explorer les dossiers crees automatiquement' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Creer une note et tester les [[wiki-links]]' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Ajouter un fichier par glisser-deposer' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Ouvrir la palette de commandes (Ctrl+K)' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Visualiser le Graph View depuis les notes' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Creer une collection par tags' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Configurer le chiffrement (Parametres > Securite)' },
                  ],
                },
              ],
            },
          ],
        },

        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Raccourcis clavier' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+K' },
                    { type: 'text', text: ' — Palette de commandes (chercher partout)' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+N' },
                    { type: 'text', text: ' — Nouvelle note' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+N' },
                    { type: 'text', text: ' — Nouveau dossier' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+B' },
                    { type: 'text', text: ' — Gras' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+I' },
                    { type: 'text', text: ' — Italique' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+X' },
                    { type: 'text', text: ' — Barre' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+E' },
                    { type: 'text', text: ' — Code inline' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+B' },
                    { type: 'text', text: ' — Liste a puces' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+7' },
                    { type: 'text', text: ' — Liste numerotee' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+9' },
                    { type: 'text', text: ' — Checklist' },
                  ],
                },
              ],
            },
          ],
        },

        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'italic' }],
              text: 'Conseil : cette note est editable ! Modifiez-la comme bon vous semble.',
            },
          ],
        },
      ],
    });
  }

  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Welcome to Filarr' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Filarr is your ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'local-first' },
          { type: 'text', text: ', ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'encrypted' },
          {
            type: 'text',
            text: ' file manager. Everything stays on your device — no data ever leaves your machine.',
          },
        ],
      },

      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key Features' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'Smart folders' },
                  { type: 'text', text: ' — Organize with colors, descriptions and tags' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'Connected notes' },
                  {
                    type: 'text',
                    text: ' — Rich editor with wiki-links, checklists, tables, drawings and code',
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'Graph View' },
                  { type: 'text', text: ' — Visualize connections between your notes and files' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'Collections' },
                  { type: 'text', text: ' — Group items from different folders by tags or rules' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'Automation' },
                  {
                    type: 'text',
                    text: ' — Create rules to sort, rename and tag files automatically',
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'AES-256-GCM encryption' },
                  { type: 'text', text: ' — Protect your files with a master password' },
                ],
              },
            ],
          },
        ],
      },

      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Wiki-Links Syntax' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Type [[ to create a link to another note, file or folder:' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: '[[Note name]]' },
                  { type: 'text', text: ' — Link to a note' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: '[[file:report.pdf]]' },
                  { type: 'text', text: ' — Link to a file' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: '[[folder:Projects]]' },
                  { type: 'text', text: ' — Link to a folder' },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Links are visible in the Graph View and in the Backlinks panel of each note.',
          },
        ],
      },

      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Formatting' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'The editor supports rich formatting:' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'bold' }], text: 'Bold' },
                  { type: 'text', text: ', ' },
                  { type: 'text', marks: [{ type: 'italic' }], text: 'Italic' },
                  { type: 'text', text: ', ' },
                  { type: 'text', marks: [{ type: 'strike' }], text: 'Strikethrough' },
                  { type: 'text', text: ', ' },
                  { type: 'text', marks: [{ type: 'underline' }], text: 'Underline' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Headings H1, H2, H3' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Bullet lists, numbered lists and checklists' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Code blocks with syntax highlighting' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Blockquotes, tables, dividers' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Color highlighting and drawings' }],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Type / to open the slash commands menu inside a note.' }],
      },

      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `Your first folder: [[${firstFolderName}]]` }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Click the link above to navigate to your first folder. You can drag & drop files directly into it.',
          },
        ],
      },

      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Getting Started' }],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Explore the auto-created folders' }],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Create a note and try [[wiki-links]]' }],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Add a file via drag & drop' }],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Open the command palette (Ctrl+K)' }],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Explore the Graph View from notes' }],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Create a collection using tags' }],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Set up encryption (Settings > Security)' }],
              },
            ],
          },
        ],
      },

      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Keyboard Shortcuts' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+K' },
                  { type: 'text', text: ' — Command palette (search everything)' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+N' },
                  { type: 'text', text: ' — New note' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+N' },
                  { type: 'text', text: ' — New folder' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+B' },
                  { type: 'text', text: ' — Bold' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+I' },
                  { type: 'text', text: ' — Italic' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+X' },
                  { type: 'text', text: ' — Strikethrough' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+E' },
                  { type: 'text', text: ' — Inline code' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+B' },
                  { type: 'text', text: ' — Bullet list' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+7' },
                  { type: 'text', text: ' — Numbered list' },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'code' }], text: 'Ctrl+Shift+9' },
                  { type: 'text', text: ' — Checklist' },
                ],
              },
            ],
          },
        ],
      },

      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [{ type: 'italic' }],
            text: 'Tip: this note is fully editable! Feel free to modify it however you like.',
          },
        ],
      },
    ],
  });
}

export function getWelcomeNotePlainText(lang: 'en' | 'fr', firstFolderName: string): string {
  if (lang === 'fr') {
    return `Bienvenue dans Filarr

Filarr est votre gestionnaire de fichiers local-first et chiffre. Tout reste sur votre appareil — aucune donnee ne transite par un serveur.

Fonctionnalites principales
- Dossiers intelligents — Organisez avec des couleurs, descriptions et tags
- Notes connectees — Editeur riche avec wiki-links, checklists, tableaux, dessins et code
- Graph View — Visualisez les connexions entre vos notes et fichiers
- Collections — Regroupez des elements de differents dossiers par tags ou regles
- Automatisation — Creez des regles pour trier, renommer et taguer automatiquement
- Chiffrement AES-256-GCM — Protegez vos fichiers avec un mot de passe maitre

Syntaxe Wiki-Links
Tapez [[ pour creer un lien :
- [[Nom de la note]] — Lien vers une note
- [[file:rapport.pdf]] — Lien vers un fichier
- [[folder:Projets]] — Lien vers un dossier

Votre premier dossier : [[${firstFolderName}]]

A faire
- Explorer les dossiers crees automatiquement
- Creer une note et tester les [[wiki-links]]
- Ajouter un fichier par glisser-deposer
- Ouvrir la palette de commandes (Ctrl+K)
- Visualiser le Graph View
- Creer une collection par tags
- Configurer le chiffrement (Parametres > Securite)

Raccourcis clavier
- Ctrl+K — Palette de commandes
- Ctrl+N — Nouvelle note
- Ctrl+Shift+N — Nouveau dossier
- Ctrl+B — Gras
- Ctrl+I — Italique
- Ctrl+E — Code inline
- Ctrl+Shift+B — Liste a puces
- Ctrl+Shift+9 — Checklist
- / — Menu de commandes rapides

Cette note est editable — modifiez-la comme bon vous semble.`;
  }

  return `Welcome to Filarr

Filarr is your local-first, encrypted file manager. Everything stays on your device — no data ever leaves your machine.

Key Features
- Smart folders — Organize with colors, descriptions and tags
- Connected notes — Rich editor with wiki-links, checklists, tables, drawings and code
- Graph View — Visualize connections between your notes and files
- Collections — Group items from different folders by tags or rules
- Automation — Create rules to sort, rename and tag files automatically
- AES-256-GCM encryption — Protect your files with a master password

Wiki-Links Syntax
Type [[ to create a link:
- [[Note name]] — Link to a note
- [[file:report.pdf]] — Link to a file
- [[folder:Projects]] — Link to a folder

Your first folder: [[${firstFolderName}]]

Getting Started
- Explore the auto-created folders
- Create a note and try [[wiki-links]]
- Add a file via drag & drop
- Open the command palette (Ctrl+K)
- Explore the Graph View
- Create a collection using tags
- Set up encryption (Settings > Security)

Keyboard Shortcuts
- Ctrl+K — Command palette
- Ctrl+N — New note
- Ctrl+Shift+N — New folder
- Ctrl+B — Bold
- Ctrl+I — Italic
- Ctrl+E — Inline code
- Ctrl+Shift+B — Bullet list
- Ctrl+Shift+9 — Checklist
- / — Slash commands menu

Tip: this note is fully editable — modify it however you like.`;
}

// ==================== DISCOVERY AREAS ====================

export interface DiscoveryArea {
  titleKey: string;
  descriptionKey: string;
  icon: string;
}

export const DISCOVERY_AREAS: DiscoveryArea[] = [
  {
    titleKey: 'onboarding.discovery.filesTitle',
    descriptionKey: 'onboarding.discovery.filesDesc',
    icon: '📁',
  },
  {
    titleKey: 'onboarding.discovery.notesTitle',
    descriptionKey: 'onboarding.discovery.notesDesc',
    icon: '📝',
  },
  {
    titleKey: 'onboarding.discovery.collectionsTitle',
    descriptionKey: 'onboarding.discovery.collectionsDesc',
    icon: '📚',
  },
  {
    titleKey: 'onboarding.discovery.automationTitle',
    descriptionKey: 'onboarding.discovery.automationDesc',
    icon: '⚡',
  },
];
