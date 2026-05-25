const path = require('path');


const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./db');
const authRoutes = require('./routes/auth');
const tasksRoutes = require('./routes/tasks');
const requireAuth = require('./middleware/requireAuth');

const app = express();
const PORT = process.env.PORT || 3005;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));

app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.session.userId);
    res.locals.currentUser = user || null;
  } else {
    res.locals.currentUser = null;
  }
  res.locals.flash = req.session.flash || null;
  if (req.session) delete req.session.flash;
  next();
});

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/tasks');
  return res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/tasks', requireAuth, tasksRoutes);

app.use((req, res) => {
  res.status(404).render('not_found', { title: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Mini task manager listening on http://localhost:${PORT}`);
});
