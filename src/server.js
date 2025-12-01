const path = require('path');
const express = require('express');
const { engine } = require('express-handlebars');
const routes = require('./routes');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
require('dotenv').config();

const app = express();

// Static files
app.use('/public', express.static(path.join(__dirname, '..', 'public')));
const storage = multer.memoryStorage();
app.locals.upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024) // 10MB default per file
  }
});

// View engine setup
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
  partialsDir: path.join(__dirname, '..', 'views', 'partials')
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false
}));
app.use((req, res, next) => { res.locals.user = req.session.user || null; next(); });
app.use('/', routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
