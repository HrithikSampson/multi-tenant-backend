import { Entity, PrimaryColumn, Column, ManyToOne, Index, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Project } from './project.entity';
import { ProjectRole } from '../db/enums';
import { User } from './user.entity';

@Entity({ name: 'project_members' })
@Index(['organizationId', 'projectId'])
export class ProjectMember {
  @PrimaryColumn({ name: 'organization_id', type: 'bigint' })
  organizationId!: string;

  @PrimaryColumn({ name: 'project_id', type: 'bigint' })
  projectId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({ type: 'enum', enum: ProjectRole, enumName: 'project_role', default: ProjectRole.VIEWER })
  role!: ProjectRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Project, p => p.members, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'project_id', referencedColumnName: 'id' },
  ])
  project!: Project;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;
}
