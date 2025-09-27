import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Project } from './project.entity';
import { User } from './user.entity';
import { TaskStatus } from '../db/enums';

@Entity({ name: 'tasks' })
@Index(['organizationId', 'projectId', 'status'])
@Index(['organizationId', 'assigneeId', 'status'])
export class Task {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'organization_id', type: 'bigint' })
  organizationId!: string;

  @Column({ name: 'project_id', type: 'bigint' })
  projectId!: string;

  @ManyToOne(() => Project, p => p.tasks, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'project_id', referencedColumnName: 'id' },
  ])
  project!: Project;

  @Column({ name: 'assignee_id', type: 'bigint', nullable: true })
  assigneeId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id', referencedColumnName: 'id' })
  assignee?: User | null;

  @Column({ name: 'assigned_by_id', type: 'bigint', nullable: true })
  assignedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_id', referencedColumnName: 'id' })
  assignedBy?: User | null;

  @Column({ type: 'enum', enum: TaskStatus, enumName: 'task_status', default: TaskStatus.TODO })
  status!: TaskStatus;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({ type: 'smallint', nullable: true })
  priority?: number | null;

  @Column({ name: 'order_in_board', type: 'int', default: 0 })
  orderInBoard!: number;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy?: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by', referencedColumnName: 'id' })
  createdByUser?: User | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy?: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by', referencedColumnName: 'id' })
  updatedByUser?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
