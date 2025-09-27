import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Organization } from './organization.entity';
import { ProjectMember } from './project-member.entity';
import { Task } from './task.entity';

@Entity({ name: 'projects' })
@Index(['organizationId', 'slug'], { unique: true })
export class Project {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'organization_id', type: 'bigint' })
  organizationId!: string;

  @ManyToOne(() => Organization, o => o.projects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', referencedColumnName: 'id' })
  organization!: Organization;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'varchar', length: 140 })
  slug!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ProjectMember, pm => pm.project) 
  members!: ProjectMember[];
  
  @OneToMany(() => Task, t => t.project) 
  tasks!: Task[];
}
