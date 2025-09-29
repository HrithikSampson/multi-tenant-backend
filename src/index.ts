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
import cookieParser from 'cookie-parser';

const app = express();
app.use(cookieParser());
morgan.token('date', () => new Date().toISOString());

const whitelistHostnames = [
  'multi-tenant-frontend-opal.vercel.app',
  'localhost',
];

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    let hostname: string;
    try { hostname = new URL(origin).hostname; } catch { return cb(new Error('Invalid Origin')); }
    const allowed = whitelistHostnames.some(h => hostname === h || hostname.endsWith(`.${h}`));
    return allowed ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
};

app.use(morgan(':date[iso] :method :url :status :response-time ms - :res[content-length]'));
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRouter);
app.use('/api/organizations', organizationRouter);
app.use('/api/organizations/:organizationId/projects/:projectId/tasks', taskRouter);
app.use('/api/organizations/:organizationId/projects', projectRouter);


app.get('/health', (_req, res) => res.send('Health check OK'));

const PORT = parseInt(process.env.PORT || '4000', 10);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
