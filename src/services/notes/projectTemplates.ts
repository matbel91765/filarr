/**
 * Modèles de GESTION DE PROJET — Filarr Notes
 *
 * Les six modèles historiques (réunion, brief, revue…) n'étaient que des
 * titres et des puces. Ceux-ci se servent des blocs que l'éditeur sait déjà
 * faire — base de données inline en vue kanban, colonnes, encadrés,
 * avancement, dates — pour qu'un projet soit PILOTABLE dès la création de la
 * note, sans rien assembler à la main.
 *
 * IDENTITÉ DES BASES — les identifiants écrits ici sont figés dans le modèle,
 * donc partagés par toutes les notes qui en sortent. C'est sans danger parce
 * que `createNewNote` fait passer le contenu par `restampCopiedDbIds` : chaque
 * note reçoit une identité de base NEUVE. Deux bases qui porteraient la même
 * feraient résoudre une relation sur la mauvaise, sans rien à l'écran qui le
 * dise — c'est la seule règle à ne jamais casser en touchant ce fichier.
 *
 * LANGUE — résolue à l'appel (`i18n.t` avec repli anglais). L'import de la
 * configuration i18n ci-dessous n'est pas décoratif : il garantit que
 * l'initialisation a eu lieu avant la première construction.
 */

import i18n from '../../i18n/config';
import type { NoteTemplate } from '../../types/notes';

// ==================== Fabriques de nœuds ====================

type Json = Record<string, unknown>;

const text = (value: string) => ({ type: 'text', text: value });
const p = (value = ''): Json => ({
  type: 'paragraph',
  ...(value ? { content: [text(value)] } : {}),
});
const h = (level: number, value: string): Json => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const bullets = (...items: string[]): Json => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [p(item)] })),
});
const tasks = (...items: string[]): Json => ({
  type: 'taskList',
  content: items.map((item) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [p(item)],
  })),
});
const callout = (type: string, title: string, body: string): Json => ({
  type: 'callout',
  attrs: { type, collapsed: false, title },
  content: [p(body)],
});
const columns = (...cols: Json[][]): Json => ({
  type: 'columns',
  attrs: { count: cols.length },
  content: cols.map((blocks) => ({ type: 'column', content: blocks })),
});
const divider = (): Json => ({ type: 'horizontalRule' });

const doc = (...content: Json[]) => JSON.stringify({ type: 'doc', content });

const t = (key: string, fallback: string) =>
  i18n.t(`notes.projectTemplates.${key}`, { defaultValue: fallback });

// ==================== Fabrique de base inline ====================

interface OptionSpec {
  key: string;
  label: string;
  color: string;
}

interface PropSpec {
  key: string;
  name: string;
  type: string;
  options?: OptionSpec[];
  /** `key` de l'option posée d'office sur toute nouvelle ligne */
  defaultOption?: string;
}

/**
 * Construit le nœud `inlineDatabase` complet (schéma + lignes + vue).
 *
 * Les identifiants sont dérivés du préfixe et des clés : stables, lisibles
 * dans le JSON, et surtout REPRODUCTIBLES — un modèle ne doit pas changer
 * d'octets d'un lancement à l'autre.
 */
function database(
  prefix: string,
  title: string,
  props: PropSpec[],
  rows: Record<string, unknown>[],
  view: 'table' | 'board',
  groupByKey?: string
): Json {
  const propId = (key: string) => `${prefix}-p-${key}`;
  const optionId = (propKey: string, optKey: string) => `${prefix}-o-${propKey}-${optKey}`;

  const properties = props.map((prop) => ({
    id: propId(prop.key),
    name: prop.name,
    type: prop.type,
    ...(prop.options
      ? {
          options: prop.options.map((option) => ({
            id: optionId(prop.key, option.key),
            label: option.label,
            color: option.color,
          })),
        }
      : {}),
    ...(prop.defaultOption ? { defaultOptionId: optionId(prop.key, prop.defaultOption) } : {}),
  }));

  // Les cellules sont écrites par CLÉ de propriété puis traduites en
  // identifiants : le modèle reste lisible, et une clé inconnue ne peut pas
  // fabriquer une cellule orpheline.
  const dbRows = rows.map((cells, index) => {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cells)) {
      const prop = props.find((candidate) => candidate.key === key);
      if (!prop) continue;
      resolved[propId(key)] =
        prop.options && typeof value === 'string' ? optionId(key, value) : value;
    }
    return { id: `${prefix}-r-${index + 1}`, cells: resolved };
  });

  const viewId = `${prefix}-v-1`;
  const groupById = groupByKey ? propId(groupByKey) : undefined;

  const data = {
    properties,
    rows: dbRows,
    views: [
      {
        id: viewId,
        name: view === 'board' ? t('view.board', 'Board') : t('view.table', 'Table'),
        type: view,
        filters: [],
        sorts: [],
        ...(groupById ? { groupBy: groupById } : {}),
      },
    ],
    activeViewId: viewId,
  };

  return {
    type: 'inlineDatabase',
    attrs: {
      title,
      view,
      groupBy: groupById ?? '',
      source: '',
      // Identité posée d'emblée ET re-frappée à chaque note créée depuis le
      // modèle (cf. l'avertissement en tête de fichier).
      dbId: `db@v:${viewId}`,
      data: JSON.stringify(data),
    },
  };
}

// ==================== Jeux d'options réutilisés ====================

const statusOptions = (): OptionSpec[] => [
  { key: 'todo', label: t('status.todo', 'To do'), color: 'gray' },
  { key: 'doing', label: t('status.doing', 'In progress'), color: 'blue' },
  { key: 'review', label: t('status.review', 'In review'), color: 'amber' },
  { key: 'done', label: t('status.done', 'Done'), color: 'green' },
  { key: 'blocked', label: t('status.blocked', 'Blocked'), color: 'red' },
];

const priorityOptions = (): OptionSpec[] => [
  { key: 'high', label: t('priority.high', 'High'), color: 'red' },
  { key: 'medium', label: t('priority.medium', 'Medium'), color: 'amber' },
  { key: 'low', label: t('priority.low', 'Low'), color: 'teal' },
];

const stamp = {
  isBuiltIn: true as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const titleVar = (label: string, fallback: string) => [
  { name: 'title', label, type: 'text' as const, defaultValue: fallback },
];

// ==================== Le corps du tableau de bord projet ====================

/**
 * Exporté à part : la commande « / » « Gestion de projet » insère exactement
 * ces blocs dans la note courante, sans le titre ni les variables du modèle.
 * Une seule définition, donc deux portes d'entrée qui ne peuvent pas diverger.
 */
export function projectBoardBlocks(): Json[] {
  return [
    callout(
      'info',
      t('project.goalTitle', 'Goal'),
      t('project.goalBody', 'What does this project have to deliver, and by when?')
    ),
    columns(
      [
        h(3, t('project.timeline', 'Timeline')),
        p(t('project.timelineBody', 'Start: TBD · Target: TBD')),
      ],
      [h(3, t('project.team', 'Team')), bullets(t('project.owner', 'Owner: '), '')]
    ),
    h(2, t('project.tasks', 'Tasks')),
    database(
      'tpl-project',
      t('project.tasks', 'Tasks'),
      [
        { key: 'name', name: t('field.task', 'Task'), type: 'text' },
        {
          key: 'status',
          name: t('field.status', 'Status'),
          type: 'select',
          options: statusOptions(),
          defaultOption: 'todo',
        },
        {
          key: 'priority',
          name: t('field.priority', 'Priority'),
          type: 'select',
          options: priorityOptions(),
          defaultOption: 'medium',
        },
        { key: 'owner', name: t('field.owner', 'Owner'), type: 'text' },
        { key: 'due', name: t('field.due', 'Due date'), type: 'date' },
        { key: 'progress', name: t('field.progress', 'Progress'), type: 'progress' },
      ],
      [
        {
          name: t('project.sampleScope', 'Frame the scope'),
          status: 'doing',
          priority: 'high',
          progress: 40,
        },
        { name: t('project.samplePlan', 'Draft the plan'), status: 'todo', priority: 'medium' },
        { name: t('project.sampleKickoff', 'Kick-off meeting'), status: 'done', progress: 100 },
      ],
      'board',
      'status'
    ),
    h(2, t('project.decisions', 'Decisions')),
    bullets(t('project.decisionSample', 'Decision — date — who decided')),
    h(2, t('project.risks', 'Risks')),
    callout(
      'warning',
      t('project.riskTitle', 'Watch out'),
      t('project.riskBody', 'Known risk, its impact, and what mitigates it.')
    ),
  ];
}

// ==================== Les modèles ====================

export function getProjectTemplates(): NoteTemplate[] {
  return [
    {
      id: 'tpl-project-board',
      name: t('project.name', 'Project board'),
      description: t('project.desc', 'Goal, kanban of tasks, decisions and risks'),
      icon: '📊', // 📊
      content: doc(h(1, '{{title}}'), ...projectBoardBlocks()),
      variables: titleVar(
        t('project.varTitle', 'Project name'),
        t('project.varDefault', 'Project')
      ),
      ...stamp,
    },
    {
      id: 'tpl-sprint',
      name: t('sprint.name', 'Sprint'),
      description: t('sprint.desc', 'Sprint goal, scope board, review and retro'),
      icon: '🏃', // 🏃
      content: doc(
        h(1, '{{title}}'),
        callout(
          'tip',
          t('sprint.goalTitle', 'Sprint goal'),
          t('sprint.goalBody', 'One sentence: what is shippable at the end?')
        ),
        columns(
          [h(3, t('sprint.dates', 'Dates')), p('{{date}} → ')],
          [h(3, t('sprint.capacity', 'Capacity')), p(t('sprint.capacityBody', 'Days available: '))]
        ),
        h(2, t('sprint.scope', 'Scope')),
        database(
          'tpl-sprint',
          t('sprint.scope', 'Scope'),
          [
            { key: 'name', name: t('field.story', 'Story'), type: 'text' },
            {
              key: 'status',
              name: t('field.status', 'Status'),
              type: 'select',
              options: statusOptions(),
              defaultOption: 'todo',
            },
            { key: 'points', name: t('field.points', 'Points'), type: 'number' },
            { key: 'owner', name: t('field.owner', 'Owner'), type: 'text' },
          ],
          [
            { name: t('sprint.sampleStory', 'First story'), status: 'todo', points: 3 },
            { name: t('sprint.sampleBug', 'Fix reported bug'), status: 'doing', points: 1 },
          ],
          'board',
          'status'
        ),
        h(2, t('sprint.review', 'Review and retrospective')),
        tasks(
          t('sprint.reviewTask', 'Demo what shipped'),
          t('sprint.retroTask', 'Run the retrospective'),
          t('sprint.nextTask', 'Carry over what did not ship')
        )
      ),
      variables: titleVar(t('sprint.varTitle', 'Sprint name'), t('sprint.varDefault', 'Sprint 1')),
      ...stamp,
    },
    {
      id: 'tpl-roadmap',
      name: t('roadmap.name', 'Roadmap'),
      description: t('roadmap.desc', 'Initiatives by quarter, with milestones'),
      icon: '🗺️', // 🗺️
      content: doc(
        h(1, '{{title}}'),
        p(t('roadmap.intro', 'What we intend to build, and roughly when.')),
        database(
          'tpl-roadmap',
          t('roadmap.initiatives', 'Initiatives'),
          [
            { key: 'name', name: t('field.initiative', 'Initiative'), type: 'text' },
            {
              key: 'quarter',
              name: t('field.quarter', 'Quarter'),
              type: 'select',
              options: [
                { key: 'q1', label: 'Q1', color: 'blue' },
                { key: 'q2', label: 'Q2', color: 'teal' },
                { key: 'q3', label: 'Q3', color: 'amber' },
                { key: 'q4', label: 'Q4', color: 'purple' },
              ],
              defaultOption: 'q1',
            },
            {
              key: 'status',
              name: t('field.status', 'Status'),
              type: 'select',
              options: statusOptions(),
              defaultOption: 'todo',
            },
            { key: 'impact', name: t('field.impact', 'Impact'), type: 'rating' },
            { key: 'owner', name: t('field.owner', 'Owner'), type: 'text' },
          ],
          [
            {
              name: t('roadmap.sampleOne', 'Flagship initiative'),
              quarter: 'q1',
              status: 'doing',
              impact: 5,
            },
            { name: t('roadmap.sampleTwo', 'Next initiative'), quarter: 'q2', status: 'todo' },
          ],
          'table'
        ),
        h(2, t('roadmap.milestones', 'Milestones')),
        tasks(
          t('roadmap.milestoneOne', 'Milestone 1 — date'),
          t('roadmap.milestoneTwo', 'Milestone 2 — date')
        )
      ),
      variables: titleVar(
        t('roadmap.varTitle', 'Roadmap name'),
        t('roadmap.varDefault', 'Roadmap')
      ),
      ...stamp,
    },
    {
      id: 'tpl-bugs',
      name: t('bugs.name', 'Bug tracker'),
      description: t('bugs.desc', 'Kanban of bugs with severity and version'),
      icon: '🐞', // 🐞
      content: doc(
        h(1, '{{title}}'),
        callout(
          'note',
          t('bugs.ruleTitle', 'One line per bug'),
          t('bugs.ruleBody', 'Steps to reproduce, expected result, actual result.')
        ),
        database(
          'tpl-bugs',
          t('bugs.name', 'Bug tracker'),
          [
            { key: 'name', name: t('field.bug', 'Bug'), type: 'text' },
            {
              key: 'status',
              name: t('field.status', 'Status'),
              type: 'select',
              options: [
                { key: 'new', label: t('bugStatus.new', 'New'), color: 'gray' },
                { key: 'confirmed', label: t('bugStatus.confirmed', 'Confirmed'), color: 'orange' },
                { key: 'doing', label: t('status.doing', 'In progress'), color: 'blue' },
                { key: 'fixed', label: t('bugStatus.fixed', 'Fixed'), color: 'green' },
                { key: 'wontfix', label: t('bugStatus.wontfix', 'Won’t fix'), color: 'gray' },
              ],
              defaultOption: 'new',
            },
            {
              key: 'severity',
              name: t('field.severity', 'Severity'),
              type: 'select',
              options: [
                { key: 'blocker', label: t('severity.blocker', 'Blocker'), color: 'red' },
                { key: 'major', label: t('severity.major', 'Major'), color: 'orange' },
                { key: 'minor', label: t('severity.minor', 'Minor'), color: 'teal' },
              ],
              defaultOption: 'major',
            },
            { key: 'version', name: t('field.version', 'Version'), type: 'text' },
            { key: 'reporter', name: t('field.reporter', 'Reported by'), type: 'text' },
          ],
          [{ name: t('bugs.sample', 'Describe the bug here'), status: 'new', severity: 'major' }],
          'board',
          'status'
        )
      ),
      variables: titleVar(t('bugs.varTitle', 'Board name'), t('bugs.varDefault', 'Bugs')),
      ...stamp,
    },
    {
      id: 'tpl-retro',
      name: t('retro.name', 'Retrospective'),
      description: t('retro.desc', 'What worked, what to improve, actions'),
      icon: '🔁', // 🔁
      content: doc(
        h(1, '{{title}}'),
        p('{{date}}'),
        columns(
          [h(3, t('retro.good', 'What worked')), bullets('')],
          [h(3, t('retro.bad', 'What to improve')), bullets('')],
          [h(3, t('retro.ideas', 'Ideas')), bullets('')]
        ),
        h(2, t('retro.actions', 'Actions')),
        tasks(t('retro.actionSample', 'Action — owner — by when')),
        divider(),
        p(t('retro.footer', 'Next retrospective: '))
      ),
      variables: titleVar(
        t('retro.varTitle', 'Retro name'),
        t('retro.varDefault', 'Retrospective')
      ),
      ...stamp,
    },
    {
      id: 'tpl-okr',
      name: t('okr.name', 'Quarterly OKRs'),
      description: t('okr.desc', 'Objectives and key results, with progress'),
      icon: '🎯', // 🎯
      content: doc(
        h(1, '{{title}}'),
        callout(
          'important',
          t('okr.ruleTitle', 'Three objectives, no more'),
          t('okr.ruleBody', 'An objective is a direction; a key result is a number.')
        ),
        database(
          'tpl-okr',
          t('okr.name', 'Quarterly OKRs'),
          [
            { key: 'name', name: t('field.keyResult', 'Key result'), type: 'text' },
            { key: 'objective', name: t('field.objective', 'Objective'), type: 'text' },
            { key: 'target', name: t('field.target', 'Target'), type: 'text' },
            { key: 'progress', name: t('field.progress', 'Progress'), type: 'progress' },
            {
              key: 'status',
              name: t('field.status', 'Status'),
              type: 'select',
              options: [
                { key: 'ontrack', label: t('okrStatus.ontrack', 'On track'), color: 'green' },
                { key: 'atrisk', label: t('okrStatus.atrisk', 'At risk'), color: 'amber' },
                { key: 'off', label: t('okrStatus.off', 'Off track'), color: 'red' },
              ],
              defaultOption: 'ontrack',
            },
          ],
          [
            {
              name: t('okr.sampleKr', 'Key result 1'),
              objective: t('okr.sampleObjective', 'Objective 1'),
              progress: 0,
              status: 'ontrack',
            },
          ],
          'table'
        ),
        h(2, t('okr.weekly', 'Weekly check-in')),
        tasks(t('okr.weeklyTask', 'Update the numbers'))
      ),
      variables: titleVar(t('okr.varTitle', 'Quarter'), t('okr.varDefault', 'OKRs')),
      ...stamp,
    },
  ];
}
