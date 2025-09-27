import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../entity/user.entity';
import { Organization } from '../entity/organization.entity';
import { OrgMembership } from '../entity/org-membership.entity';
import { Project } from '../entity/project.entity';
import { ProjectMember } from '../entity/project-member.entity';
import { Task } from '../entity/task.entity';
import { Activity } from '../entity/activity.entity';

export const createDataSource = () => {
  return new DataSource({
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
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
};

export const AppDataSource = createDataSource();

export const getInitializedDataSource = async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
};