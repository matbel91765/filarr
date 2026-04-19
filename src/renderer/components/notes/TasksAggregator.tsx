/**
 * TasksAggregator — Filarr Notes
 *
 * Cross-note task aggregation view.
 * Scans all notes' TipTap JSON content for taskItem nodes.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setEditingNote, updateNote } from '../../../store/slices/notesSlice';
import './TasksAggregator.css';

interface Task {
  noteId: string;
  noteTitle: string;
  text: string;
  checked: boolean;
  path: number[];
}

function extractText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.content) return node.content.map(extractText).join('');
  return '';
}

function extractTasks(noteId: string, noteTitle: string, content: string): Task[] {
  try {
    const doc = JSON.parse(content);
    const tasks: Task[] = [];
    function walk(node: any, path: number[] = []) {
      if (node.type === 'taskItem') {
        tasks.push({
          noteId,
          noteTitle,
          checked: node.attrs?.checked || false,
          text: extractText(node),
          path,
        });
      }
      if (node.content) {
        node.content.forEach((child: any, i: number) => walk(child, [...path, i]));
      }
    }
    walk(doc);
    return tasks;
  } catch {
    return [];
  }
}

function toggleTaskInContent(content: string, path: number[], checked: boolean): string {
  try {
    const doc = JSON.parse(content);
    let current = doc;
    for (let i = 0; i < path.length - 1; i++) {
      current = current.content[path[i]];
    }
    const target = current.content[path[path.length - 1]];
    if (target && target.type === 'taskItem') {
      target.attrs = { ...target.attrs, checked };
    }
    return JSON.stringify(doc);
  } catch {
    return content;
  }
}

export const TasksAggregator: React.FC = () => {
  const dispatch = useDispatch();
  const notesById = useSelector((state: any) => state.notes?.byId || {});
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [search, setSearch] = useState('');

  const allTasks = useMemo(() => {
    const tasks: Task[] = [];
    Object.values(notesById).forEach((note: any) => {
      if (note.content && !note.deletedAt) {
        tasks.push(...extractTasks(note.id, note.title || 'Untitled', note.content));
      }
    });
    return tasks;
  }, [notesById]);

  const filteredTasks = useMemo(() => {
    let result = allTasks;
    if (filter === 'open') result = result.filter((t) => !t.checked);
    if (filter === 'completed') result = result.filter((t) => t.checked);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) => t.text.toLowerCase().includes(q) || t.noteTitle.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allTasks, filter, search]);

  const openCount = useMemo(() => allTasks.filter((t) => !t.checked).length, [allTasks]);
  const completedCount = useMemo(() => allTasks.filter((t) => t.checked).length, [allTasks]);

  // Group by note
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    filteredTasks.forEach((t) => {
      const arr = map.get(t.noteId) || [];
      arr.push(t);
      map.set(t.noteId, arr);
    });
    return map;
  }, [filteredTasks]);

  const handleToggle = useCallback(
    (task: Task) => {
      const note = notesById[task.noteId];
      if (!note) return;
      const newContent = toggleTaskInContent(note.content, task.path, !task.checked);
      dispatch(updateNote({ id: task.noteId, changes: { content: newContent } }));
    },
    [notesById, dispatch]
  );

  const handleGoToNote = useCallback(
    (noteId: string) => {
      dispatch(setEditingNote(noteId));
    },
    [dispatch]
  );

  return (
    <div className="tasks-aggregator">
      <div className="tasks-aggregator__header">
        <h3 className="tasks-aggregator__title">Tasks</h3>
        <div className="tasks-aggregator__stats">
          <span className="tasks-aggregator__stat tasks-aggregator__stat--open">{openCount} open</span>
          <span className="tasks-aggregator__stat">{completedCount} done</span>
          <span className="tasks-aggregator__stat">{allTasks.length} total</span>
        </div>
      </div>

      <div className="tasks-aggregator__controls">
        <input
          className="tasks-aggregator__search"
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="tasks-aggregator__filters">
          {(['all', 'open', 'completed'] as const).map((f) => (
            <button
              key={f}
              className={`tasks-aggregator__filter ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Done'}
            </button>
          ))}
        </div>
      </div>

      <div className="tasks-aggregator__list">
        {grouped.size === 0 && (
          <div className="tasks-aggregator__empty">No tasks found</div>
        )}
        {Array.from(grouped.entries()).map(([noteId, tasks]) => (
          <div key={noteId} className="tasks-aggregator__group">
            <button
              className="tasks-aggregator__note-title"
              onClick={() => handleGoToNote(noteId)}
            >
              {tasks[0].noteTitle}
            </button>
            {tasks.map((task, i) => (
              <label key={i} className={`tasks-aggregator__task ${task.checked ? 'is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={task.checked}
                  onChange={() => handleToggle(task)}
                  className="tasks-aggregator__checkbox"
                />
                <span className="tasks-aggregator__task-text">{task.text}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
