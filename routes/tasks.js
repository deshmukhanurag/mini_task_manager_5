const express = require('express');
const db = require('../db');
const { trackEvent } = require('../lib/pendo');

const router = express.Router();
const PRIORITIES = ['low', 'medium', 'high'];

function getOwnedTask(taskId, userId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
}

// Whole days from today until a YYYY-MM-DD date. Negative when the date has passed.
function daysUntil(dateStr) {
  const due = Date.parse(dateStr);
  if (Number.isNaN(due)) return null;
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

router.get('/', (req, res) => {
  const filter = req.query.filter || 'all';
  const userId = req.session.userId;

  let where = 'user_id = ?';
  const params = [userId];
  if (filter === 'active') where += ' AND completed = 0';
  else if (filter === 'completed') where += ' AND completed = 1';
  else if (filter === 'high') where += " AND priority = 'high'";

  const tasks = db.prepare(
    `SELECT * FROM tasks WHERE ${where} ORDER BY completed ASC, due_date IS NULL, due_date ASC, created_at DESC`
  ).all(...params);

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high,
      COUNT(*) AS total
    FROM tasks WHERE user_id = ?
  `).get(userId);

  res.render('tasks/index', {
    title: 'My tasks',
    tasks,
    filter,
    counts,
    error: null,
    form: { title: '', description: '', priority: 'medium', due_date: '' },
  });
});

router.post('/', (req, res) => {
  const userId = req.session.userId;
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim() || null;
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'medium';
  const due_date = (req.body.due_date || '').trim() || null;

  if (!title) {
    const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC').all(userId);
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high,
        COUNT(*) AS total
      FROM tasks WHERE user_id = ?
    `).get(userId);
    return res.status(400).render('tasks/index', {
      title: 'My tasks',
      tasks,
      filter: 'all',
      counts,
      error: 'Task title is required.',
      form: { title, description: description || '', priority, due_date: due_date || '' },
    });
  }

  const info = db.prepare(`
    INSERT INTO tasks (user_id, title, description, priority, due_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, title, description, priority, due_date);

  // Track Event: a task passed validation and was saved.
  trackEvent('task_created', {
    visitorId: userId,
    req,
    properties: {
      task_id: Number(info.lastInsertRowid),
      priority,
      has_due_date: !!due_date,
      has_description: !!description,
      due_in_days: due_date ? daysUntil(due_date) : null,
    },
  });

  req.session.flash = { type: 'success', message: 'Task created.' };
  res.redirect('/tasks');
});

router.get('/:id/edit', (req, res) => {
  const task = getOwnedTask(req.params.id, req.session.userId);
  if (!task) return res.redirect('/tasks');
  res.render('tasks/edit', { title: 'Edit task', task, error: null });
});

router.post('/:id', (req, res) => {
  const userId = req.session.userId;
  const task = getOwnedTask(req.params.id, userId);
  if (!task) return res.redirect('/tasks');

  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim() || null;
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'medium';
  const due_date = (req.body.due_date || '').trim() || null;

  if (!title) {
    return res.status(400).render('tasks/edit', {
      title: 'Edit task',
      task: { ...task, title, description, priority, due_date },
      error: 'Task title is required.',
    });
  }

  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, priority = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(title, description, priority, due_date, task.id, userId);

  // Track Event: a task edit passed validation and was saved.
  const updates = { title, description, priority, due_date };
  const fieldsChanged = Object.keys(updates).filter((key) => (task[key] ?? null) !== updates[key]);
  trackEvent('task_updated', {
    visitorId: userId,
    req,
    properties: {
      task_id: task.id,
      fields_changed: fieldsChanged,
      previous_priority: task.priority,
      priority,
      has_due_date: !!due_date,
    },
  });

  req.session.flash = { type: 'success', message: 'Task updated.' };
  res.redirect('/tasks');
});

router.post('/:id/toggle', (req, res) => {
  const userId = req.session.userId;
  const task = getOwnedTask(req.params.id, userId);
  if (!task) return res.redirect('/tasks');
  db.prepare('UPDATE tasks SET completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(task.completed ? 0 : 1, task.id, userId);
  // Track Event: the task's completed state changed. `completed` is the new state.
  const dueInDays = task.due_date ? daysUntil(task.due_date) : null;
  trackEvent('task_completion_changed', {
    visitorId: userId,
    req,
    properties: {
      task_id: task.id,
      completed: !task.completed,
      priority: task.priority,
      had_due_date: !!task.due_date,
      was_overdue: !task.completed && dueInDays !== null && dueInDays < 0,
      filter: req.query.filter || 'all',
    },
  });
  res.redirect(req.get('Referrer') || '/tasks');
});

router.post('/:id/delete', (req, res) => {
  const userId = req.session.userId;
  const task = getOwnedTask(req.params.id, userId);
  const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  // Track Event: a task row was removed.
  if (task && info.changes > 0) {
    trackEvent('task_deleted', {
      visitorId: userId,
      req,
      properties: {
        task_id: task.id,
        priority: task.priority,
        was_completed: !!task.completed,
        rows_deleted: info.changes,
      },
    });
  }
  req.session.flash = { type: 'success', message: 'Task deleted.' };
  res.redirect('/tasks');
});

module.exports = router;
