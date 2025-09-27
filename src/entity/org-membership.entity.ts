import { Entity, Column, ManyToOne, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Organization } from './organization.entity';
import { User } from './user.entity';
import { OrgRole } from '../db/enums';

@Entity({ name: 'org_memberships' })
@Index(['userId'])
@Index(['organizationId', 'role'])
export class OrgMembership {
  @PrimaryColumn({ name: 'organization_id', type: 'bigint' })
  organizationId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({ type: 'enum', enum: OrgRole, enumName: 'org_role', default: OrgRole.USER })
  role!: OrgRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Organization, o => o.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', referencedColumnName: 'id' })
  organization!: Organization;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;
}
