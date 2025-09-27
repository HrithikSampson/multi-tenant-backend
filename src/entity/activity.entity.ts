import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ActivityKind } from '../db/enums';
import { Organization } from './organization.entity';
import { User } from './user.entity';

@Entity({ name: 'activities' })
@Index(['organizationId', 'createdAt'])
export class Activity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'organization_id', type: 'bigint' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', referencedColumnName: 'id' })
  organization!: Organization;

  @Column({ name: 'actor_id', type: 'bigint' })
  actorId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id', referencedColumnName: 'id' })
  actor!: User;

  @Column({ type: 'enum', enum: ActivityKind, enumName: 'activity_kind' })
  kind!: ActivityKind;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'object_type', type: 'varchar', length: 40, nullable: true })
  objectType?: string | null;

  @Column({ name: 'object_id', type: 'bigint', nullable: true })
  objectId?: string | null;

  @Column({ name: 'meta', type: 'jsonb', default: () => `'{}'::jsonb` })
  meta!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
