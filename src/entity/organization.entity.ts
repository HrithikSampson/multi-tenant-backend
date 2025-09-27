import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { OrgMembership } from './org-membership.entity';
import { Project } from './project.entity';

@Entity({ name: 'organizations' })
export class Organization {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'citext', name: 'subdomain' })
  subdomain!: string;

  @Column({ type: 'uuid', name: 'room_key' })
  roomKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => OrgMembership, m => m.organization) 
  memberships!: OrgMembership[];
  
  @OneToMany(() => Project, p => p.organization) 
  projects!: Project[];
}