import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors, { CorsOptions } from 'cors';
import morgan from 'morgan';
import authRouter from './controller/auth.controller';
import organizationRouter from './controller/organization.controller';
import projectRouter from './controller/project.controller';
import taskRouter from './controller/task.controller';
import { AppDataSource } from './config/database';

const app = express();
const PORT = process.env.PORT || 4000;

morgan.token('date', () => new Date().toISOString());

const whitelistHostnames = [
  'multi-tenant-frontend-opal.vercel.app',
  'localhost',
];

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return callback(new Error('Invalid Origin'));
    }
    const allowed = whitelistHostnames.some(
      (allowedHost) =>
        hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
    );
    allowed ? callback(null, true) : callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Access-Control-Allow-Origin'],
};

// logging first
app.use(
  morgan(':date[iso] :method :url :status :response-time ms - :res[content-length]')
);

// CORS middleware first
app.use(cors(corsOptions));

app.options('*', (req, res) => {
  // mirror cors options in case the above didn't run
  res.setHeader('Access-Control-Allow-Origin', 'https://multi-tenant-frontend-opal.vercel.app');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  return res.status(204).end();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/organizations', organizationRouter);
app.use('/api/projects', projectRouter);
app.use('/api/tasks', taskRouter);

app.get('/health', (_req, res) => res.send('Health check OK'));

AppDataSource.initialize()
  .then(() => {
    console.log('Database connection established');
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error: any) => {
    console.error('Error during database initialization:', error);
    process.exit(1);
  });
