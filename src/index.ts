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
const PORT = process.env.PORT || 3000;

morgan.token('date', () => {
  return new Date().toISOString();
});


const whitelistHostnames = [
  // apex hosts you trust
  'multitenant-frontend-15a490s74-hrithiks-projects-a05d4764.vercel.app',
  'multi-tenant-frontend-opal.vercel.app',
  'http://localhost:3000',
];

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // allow non-browser (no Origin) like curl/cron/health checks
    if (!origin) return callback(null, true);

    // robust parse
    let hostname: string;
    try {
      hostname = new URL(origin).hostname; // e.g. foo.bar.com
    } catch {
      return callback(new Error('Invalid Origin'));
    }

    // allow apex or any subdomain of items in whitelistHostnames
    const allowed = whitelistHostnames.some((allowedHost) =>
      hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
    );

    if (allowed) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true, // if you use cookies/Authorization
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
};


app.use(
  morgan(':date[iso] :method :url :status :response-time ms - :res[content-length]')
);

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/organizations', organizationRouter);
app.use('/api/projects', projectRouter);
app.use('/api/tasks', taskRouter);

app.get('/health', (_req, res) => {

  res.send('Health check OK');
});

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