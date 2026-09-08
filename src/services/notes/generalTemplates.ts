/**
 * Modèles GÉNÉRAUX — Filarr Notes.
 *
 * Les six premiers portent les identifiants historiques (`tpl-meeting`,
 * `tpl-project`…) : des notes existantes s'y réfèrent, et changer un
 * identifiant les orphelinerait. Leur CONTENU, lui, est entièrement refait —
 * ils n'étaient que des titres et des puces, alors que l'éditeur sait faire des
 * encadrés, des colonnes, des tableaux et des blocs dépliables. Les six
 * suivants sont nouveaux.
 *
 * Même contrat que le pack projet : libellés résolus par i18n à la
 * construction, blocs bâtis avec les fabriques partagées.
 */

import type { NoteTemplate } from '../../types/notes';
import {
  BUILT_IN_STAMP,
  bullets,
  callout,
  columns,
  divider,
  doc,
  h,
  makeT,
  numbered,
  p,
  quote,
  table,
  tasks,
  titleVar,
  toggle,
} from './templateBuilders';

const t = makeT('notes.generalTemplates');

export function getGeneralTemplates(): NoteTemplate[] {
  return [
    // ==================== Réunion ====================
    {
      id: 'tpl-meeting',
      name: t('meeting.name', 'Meeting notes'),
      description: t('meeting.desc', 'Agenda, decisions and action items'),
      icon: '🤝',
      content: doc(
        h(1, '{{title}}'),
        callout(
          'info',
          t('meeting.goalTitle', 'Purpose'),
          t('meeting.goalBody', 'Why are we meeting, and what has to come out of it?')
        ),
        columns(
          [h(3, t('meeting.who', 'Participants')), bullets('', '')],
          [
            h(3, t('meeting.when', 'When & where')),
            p('{{date}}'),
            p(t('meeting.where', 'Place / link: ')),
          ]
        ),
        h(2, t('meeting.agenda', 'Agenda')),
        numbered(t('meeting.topic', 'Topic'), ''),
        h(2, t('meeting.decisions', 'Decisions')),
        table(
          [t('field.decision', 'Decision'), t('field.who', 'Owner'), t('field.when', 'By when')],
          ['', '', '']
        ),
        h(2, t('meeting.actions', 'Action items')),
        tasks(t('meeting.actionSample', 'Action — owner — by when')),
        toggle(t('meeting.raw', 'Raw notes'), p(''))
      ),
      variables: [
        ...titleVar(t('meeting.varTitle', 'Meeting title'), t('meeting.varDefault', 'Meeting')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Brief de projet ====================
    {
      id: 'tpl-project',
      name: t('brief.name', 'Project brief'),
      description: t('brief.desc', 'Scope, key results, risks and milestones'),
      icon: '📋',
      content: doc(
        h(1, '{{title}}'),
        callout(
          'important',
          t('brief.goalTitle', 'The one thing'),
          t('brief.goalBody', 'One sentence. If only this ships, the project was worth it.')
        ),
        columns(
          [h(3, t('brief.dates', 'Dates')), p(t('brief.datesBody', 'Start: · Target: '))],
          [h(3, t('brief.team', 'Team')), bullets(t('brief.owner', 'Owner: '), '')],
          [h(3, t('brief.budget', 'Means')), p('')]
        ),
        h(2, t('brief.results', 'Key results')),
        tasks(t('brief.resultSample', 'Measurable result'), '', ''),
        h(2, t('brief.milestones', 'Milestones')),
        table(
          [
            t('field.milestone', 'Milestone'),
            t('field.when', 'By when'),
            t('field.status', 'Status'),
          ],
          ['', '', '']
        ),
        h(2, t('brief.risks', 'Risks')),
        callout(
          'warning',
          t('brief.riskTitle', 'What could sink this'),
          t('brief.riskBody', 'The risk, its impact, and what reduces it.')
        ),
        h(2, t('brief.outOfScope', 'Out of scope')),
        bullets(t('brief.outSample', 'Explicitly NOT doing'))
      ),
      variables: titleVar(t('brief.varTitle', 'Project name'), t('brief.varDefault', 'Project')),
      ...BUILT_IN_STAMP,
    },

    // ==================== Revue de document ====================
    {
      id: 'tpl-review',
      name: t('review.name', 'Document review'),
      description: t('review.desc', 'Structured feedback, verdict and follow-up'),
      icon: '🔍',
      content: doc(
        h(1, '{{title}}'),
        columns(
          [h(3, t('review.what', 'Document')), p(t('review.link', 'Link / reference: '))],
          [h(3, t('review.who', 'Reviewer')), p(''), p('{{date}}')]
        ),
        h(2, t('review.summary', 'Summary')),
        p(t('review.summaryBody', 'In two lines: what it says, and whether it holds.')),
        h(2, t('review.points', 'Point by point')),
        table(
          [
            t('field.section', 'Section'),
            t('review.remark', 'Remark'),
            t('field.severity', 'Severity'),
          ],
          ['', '', ''],
          ['', '', '']
        ),
        h(2, t('review.verdict', 'Verdict')),
        callout(
          'success',
          t('review.verdictTitle', 'Decision'),
          t('review.verdictBody', 'Approved / approved with changes / to rework — and why.')
        ),
        h(2, t('review.followUp', 'Follow-up')),
        tasks(t('review.followSample', 'Change to make — owner'))
      ),
      variables: [
        ...titleVar(t('review.varTitle', 'Document name'), t('review.varDefault', 'Review')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Journal de décision ====================
    {
      id: 'tpl-decision',
      name: t('decision.name', 'Decision log'),
      description: t('decision.desc', 'Context, options compared, decision and consequences'),
      icon: '⚖️',
      content: doc(
        h(1, '{{title}}'),
        callout(
          'note',
          t('decision.statusTitle', 'Status'),
          t('decision.statusBody', 'Pending · {{date}} · decided by: ')
        ),
        h(2, t('decision.context', 'Context')),
        p(t('decision.contextBody', 'What forces a choice, and by when it must be made.')),
        h(2, t('decision.options', 'Options')),
        table(
          [
            t('field.option', 'Option'),
            t('decision.pros', 'For'),
            t('decision.cons', 'Against'),
            t('decision.cost', 'Cost'),
          ],
          ['A', '', '', ''],
          ['B', '', '', ''],
          ['C', '', '', '']
        ),
        h(2, t('decision.chosen', 'Decision')),
        callout(
          'important',
          t('decision.chosenTitle', 'We chose'),
          t('decision.chosenBody', 'Which option, and the reason that decided it.')
        ),
        h(2, t('decision.consequences', 'Consequences')),
        bullets(t('decision.consequenceSample', 'What this makes easier — and harder')),
        h(2, t('decision.revisit', 'Revisit')),
        tasks(
          t('decision.revisitTask', 'Announce the decision'),
          t('decision.reviewTask', 'Review it in one month')
        )
      ),
      variables: [
        ...titleVar(t('decision.varTitle', 'Decision'), t('decision.varDefault', 'Decision')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Bilan hebdomadaire ====================
    {
      id: 'tpl-weekly',
      name: t('weekly.name', 'Weekly review'),
      description: t('weekly.desc', 'What shipped, what is stuck, what comes next'),
      icon: '📆',
      content: doc(
        h(1, t('weekly.heading', 'Week of {{date}}')),
        columns(
          [h(3, t('weekly.done', 'Shipped')), tasks('')],
          [h(3, t('weekly.doing', 'In flight')), tasks('')],
          [h(3, t('weekly.blocked', 'Stuck')), bullets('')]
        ),
        h(2, t('weekly.lessons', 'What I learned')),
        p(''),
        h(2, t('weekly.next', 'Next week')),
        tasks(t('weekly.nextSample', 'The one thing that matters'), '', ''),
        divider(),
        toggle(t('weekly.raw', 'Loose notes'), p(''))
      ),
      variables: [
        { name: 'date', label: t('weekly.varDate', 'Week start'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Brainstorming ====================
    {
      id: 'tpl-brainstorm',
      name: t('brainstorm.name', 'Brainstorm'),
      description: t('brainstorm.desc', 'Collect ideas, sort them, pick one'),
      icon: '💡',
      content: doc(
        h(1, '{{title}}'),
        callout(
          'tip',
          t('brainstorm.ruleTitle', 'One rule'),
          t('brainstorm.ruleBody', 'Collect first, judge later. Quantity beats quality here.')
        ),
        h(2, t('brainstorm.question', 'The question')),
        p(t('brainstorm.questionBody', 'What exactly are we trying to solve?')),
        columns(
          [h(3, t('brainstorm.ideas', 'Ideas')), bullets('', '', '')],
          [h(3, t('brainstorm.promising', 'Worth digging')), bullets('')],
          [h(3, t('brainstorm.parked', 'Parked')), bullets('')]
        ),
        h(2, t('brainstorm.next', 'Next steps')),
        tasks(t('brainstorm.nextSample', 'Prototype the most promising one'))
      ),
      variables: titleVar(
        t('brainstorm.varTitle', 'Topic'),
        t('brainstorm.varDefault', 'Brainstorm')
      ),
      ...BUILT_IN_STAMP,
    },

    // ==================== Journal quotidien (nouveau) ====================
    {
      id: 'tpl-daily',
      name: t('daily.name', 'Daily note'),
      description: t('daily.desc', 'Three priorities, what happened, what carries over'),
      icon: '🗓️',
      content: doc(
        h(1, '{{date}}'),
        callout(
          'important',
          t('daily.focusTitle', 'Today, above all'),
          t('daily.focusBody', 'One sentence. The day is a success if this is done.')
        ),
        h(2, t('daily.priorities', 'Three priorities')),
        tasks('1. ', '2. ', '3. '),
        columns(
          [h(3, t('daily.log', 'Log')), p('')],
          [h(3, t('daily.thoughts', 'On my mind')), bullets('')]
        ),
        h(2, t('daily.carry', 'Carries over')),
        tasks(''),
        divider(),
        p(t('daily.gratitude', 'One good thing today: '))
      ),
      variables: [{ name: 'date', label: t('field.date', 'Date'), type: 'date' as const }],
      ...BUILT_IN_STAMP,
    },

    // ==================== Note de lecture (nouveau) ====================
    {
      id: 'tpl-reading',
      name: t('reading.name', 'Reading note'),
      description: t('reading.desc', 'Source, quotes, key ideas and what to do with them'),
      icon: '📚',
      content: doc(
        h(1, '{{title}}'),
        columns(
          [
            h(3, t('reading.source', 'Source')),
            p(t('reading.author', 'Author: ')),
            p(t('reading.link', 'Link: ')),
          ],
          [
            h(3, t('reading.status', 'Status')),
            p(t('reading.progress', 'Progress: ')),
            p(t('reading.rating', 'Rating: ')),
          ]
        ),
        h(2, t('reading.thesis', 'In one sentence')),
        p(t('reading.thesisBody', 'What is the author actually claiming?')),
        h(2, t('reading.quotes', 'Quotes')),
        quote(t('reading.quoteSample', 'Copy the passage here — page ')),
        h(2, t('reading.ideas', 'Key ideas')),
        bullets('', ''),
        h(2, t('reading.disagree', 'Where I disagree')),
        p(''),
        h(2, t('reading.use', 'What I do with it')),
        tasks(t('reading.useSample', 'Apply it to — '))
      ),
      variables: titleVar(t('reading.varTitle', 'Title'), t('reading.varDefault', 'Reading note')),
      ...BUILT_IN_STAMP,
    },

    // ==================== Point individuel (nouveau) ====================
    {
      id: 'tpl-one-on-one',
      name: t('oneOnOne.name', 'One-on-one'),
      description: t('oneOnOne.desc', 'Their topics, my topics, follow-up that survives'),
      icon: '👥',
      content: doc(
        h(1, '{{title}}'),
        p('{{date}}'),
        h(2, t('oneOnOne.previous', 'Since last time')),
        tasks(t('oneOnOne.previousSample', 'Carried over from the previous one')),
        columns(
          [h(3, t('oneOnOne.theirs', 'Their topics')), bullets('', '')],
          [h(3, t('oneOnOne.mine', 'My topics')), bullets('', '')]
        ),
        h(2, t('oneOnOne.feedback', 'Feedback')),
        columns(
          [h(3, t('oneOnOne.keep', 'Keep doing')), bullets('')],
          [h(3, t('oneOnOne.change', 'Change')), bullets('')]
        ),
        h(2, t('oneOnOne.actions', 'Actions')),
        tasks('', ''),
        toggle(t('oneOnOne.private', 'Private notes'), p(''))
      ),
      variables: [
        ...titleVar(t('oneOnOne.varTitle', 'With whom'), t('oneOnOne.varDefault', 'One-on-one')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Entretien (nouveau) ====================
    {
      id: 'tpl-interview',
      name: t('interview.name', 'Interview'),
      description: t(
        'interview.desc',
        'Scorecard, evidence, and a verdict written before the debrief'
      ),
      icon: '🎙️',
      content: doc(
        h(1, '{{title}}'),
        columns(
          [h(3, t('interview.who', 'Candidate')), p(''), p(t('interview.role', 'Role: '))],
          [h(3, t('interview.when', 'When')), p('{{date}}'), p(t('interview.panel', 'Panel: '))]
        ),
        callout(
          'note',
          t('interview.ruleTitle', 'Write the verdict before the debrief'),
          t('interview.ruleBody', 'Otherwise the room decides for you.')
        ),
        h(2, t('interview.grid', 'Scorecard')),
        table(
          [
            t('field.criterion', 'Criterion'),
            t('field.score', 'Score'),
            t('interview.evidence', 'Evidence'),
          ],
          ['', '', ''],
          ['', '', ''],
          ['', '', '']
        ),
        h(2, t('interview.notes', 'Notes')),
        p(''),
        h(2, t('interview.verdict', 'Verdict')),
        callout(
          'success',
          t('interview.verdictTitle', 'Recommendation'),
          t('interview.verdictBody', 'Yes / no / more evidence needed — and the deciding reason.')
        )
      ),
      variables: [
        ...titleVar(t('interview.varTitle', 'Candidate'), t('interview.varDefault', 'Interview')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Cours / formation (nouveau) ====================
    {
      id: 'tpl-course',
      name: t('course.name', 'Class notes'),
      description: t('course.desc', 'Outline, notes, open questions and revision'),
      icon: '🎓',
      content: doc(
        h(1, '{{title}}'),
        columns(
          [h(3, t('course.subject', 'Subject')), p(''), p('{{date}}')],
          [h(3, t('course.source', 'Teacher / source')), p('')]
        ),
        h(2, t('course.outline', 'Outline')),
        numbered('', '', ''),
        h(2, t('course.notes', 'Notes')),
        p(''),
        h(2, t('course.questions', 'Open questions')),
        callout(
          'warning',
          t('course.questionTitle', 'Did not understand'),
          t('course.questionBody', 'Write it down NOW — it will not come back later.')
        ),
        h(2, t('course.revision', 'Revision')),
        tasks(
          t('course.revisionOne', 'Re-read within 24 h'),
          t('course.revisionTwo', 'Turn into flashcards'),
          t('course.revisionThree', 'Explain it to someone')
        )
      ),
      variables: [
        ...titleVar(t('course.varTitle', 'Class'), t('course.varDefault', 'Class notes')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },

    // ==================== Incident / post-mortem (nouveau) ====================
    {
      id: 'tpl-incident',
      name: t('incident.name', 'Incident review'),
      description: t('incident.desc', 'Timeline, root cause, and fixes that outlive the panic'),
      icon: '🚨',
      content: doc(
        h(1, '{{title}}'),
        callout(
          'error',
          t('incident.impactTitle', 'Impact'),
          t('incident.impactBody', 'Who was affected, how long, and how badly.')
        ),
        columns(
          [h(3, t('incident.detected', 'Detected')), p('{{date}}')],
          [h(3, t('incident.resolved', 'Resolved')), p('')],
          [h(3, t('incident.severity', 'Severity')), p('')]
        ),
        h(2, t('incident.timeline', 'Timeline')),
        table(
          [
            t('field.time', 'Time'),
            t('incident.event', 'What happened'),
            // PAS `field.who` : cette colonne dit QUI A AGI a cet instant, la
            // ou `field.who` designe le RESPONSABLE d'une decision. Une seule
            // cle pour deux sens donne forcement une traduction fausse dans
            // l'un des deux tableaux.
            t('field.actor', 'Who'),
          ],
          ['', '', ''],
          ['', '', '']
        ),
        h(2, t('incident.cause', 'Root cause')),
        p(t('incident.causeBody', 'Not "who" — "what made this possible".')),
        h(2, t('incident.fix', 'Fixes')),
        tasks(
          t('incident.fixNow', 'Immediate — stop the bleeding'),
          t('incident.fixLater', 'Structural — make it impossible again'),
          t('incident.fixDetect', 'Detection — see it sooner next time')
        ),
        h(2, t('incident.lessons', 'What we learned')),
        bullets('')
      ),
      variables: [
        ...titleVar(t('incident.varTitle', 'Incident'), t('incident.varDefault', 'Incident')),
        { name: 'date', label: t('field.date', 'Date'), type: 'date' as const },
      ],
      ...BUILT_IN_STAMP,
    },
  ];
}
