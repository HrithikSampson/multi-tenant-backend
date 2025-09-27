import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { User } from './entity/user.entity';
import { Organization } from './entity/organization.entity';
import { OrgMembership } from './entity/org-membership.entity';
import { Project } from './entity/project.entity';
import { ProjectMember } from './entity/project-member.entity';
import { Task } from './entity/task.entity';
import { Activity } from './entity/activity.entity';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'multi_tenant',
  entities: [User, Organization, OrgMembership, Project, ProjectMember, Task, Activity],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  ssl: { rejectUnauthorized: false },
  extra: {
    connectionLimit: 1,
    acquireTimeoutMillis: 30000,
    timeout: 30000,
  },
});