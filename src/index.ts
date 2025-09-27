import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
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

app.use(
  morgan(':date[iso] :method :url :status :response-time ms - :res[content-length]')
);

app.use(cors({
    origin: '*',
}));

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