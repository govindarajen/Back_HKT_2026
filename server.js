const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const createError = require('http-errors');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 80;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('------------- MongoDB connected -------------'))
.catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({
  origin: true,  // Allow any origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));
app.options('*', cors());


// Routes
const usersRouter = require('./routes/users');
const groupsRouter = require('./routes/groups')
const documentsRouter = require('./routes/documents');


const basePath = process.env.BASE_PATH || '/api';

app.use( basePath + '/users', usersRouter);
app.use( basePath + '/groups', groupsRouter);
app.use( basePath + '/documents', documentsRouter);

// API Test Route
app.get('/api', (req, res) => {
  res.send('API v0.1.0 | Alpha');
});

app.get('/', function(req, res, next) {
  res.send('API v0.1.0 | Alpha');
});


// Catch 404
app.use((req, res, next) => {
  next(createError(404, 'Not Found'));
});

// Error Handler (No Views)
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    message: err.message,
    error: req.app.get('env') === 'development' ? err : {},
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n -------------------------- \n Server running at http://localhost:${PORT} \n --------------------------`);
});
