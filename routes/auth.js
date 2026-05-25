const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const pendo = require('../pendo');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.render('signup', { title: 'Sign up', error: null, email: '' });
});

router.post('/signup', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('signup', { title: 'Sign up', error: 'Enter a valid email address.', email });
  }
  if (password.length < 8) {
    return res.status(400).render('signup', { title: 'Sign up', error: 'Password must be at least 8 characters.', email });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(400).render('signup', { title: 'Sign up', error: 'An account with that email already exists.', email });
  }

  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  req.session.userId = info.lastInsertRowid;
  pendo.track('user_signed_up', info.lastInsertRowid, {
    email_domain: email.split('@')[1] || '',
    user_id: String(info.lastInsertRowid),
  });
  req.session.flash = { type: 'success', message: 'Welcome! Your account is ready.' };
  res.redirect('/tasks');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  res.render('login', { title: 'Log in', error: null, email: '' });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  const ok = user && bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).render('login', { title: 'Log in', error: 'Invalid email or password.', email });
  }

  req.session.userId = user.id;
  pendo.track('user_logged_in', user.id, {
    user_id: String(user.id),
    email_domain: email.split('@')[1] || '',
  });
  res.redirect('/tasks');
});

router.post('/logout', (req, res) => {
  const userId = req.session.userId;
  pendo.track('user_logged_out', userId, {
    user_id: String(userId),
  });
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
