import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class Init1710000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const sql = fs.readFileSync(path.join(__dirname, '1710000000000-init.sql'), 'utf8');
    await queryRunner.query(sql);
  }
  
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SCHEMA IF EXISTS app CASCADE');
    await queryRunner.query('DROP TYPE IF EXISTS org_role CASCADE');
    await queryRunner.query('DROP TYPE IF EXISTS project_role CASCADE');
    await queryRunner.query('DROP TYPE IF EXISTS task_status CASCADE');
    await queryRunner.query('DROP TYPE IF EXISTS activity_kind CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS activities CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS tasks CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS project_members CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS projects CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS org_memberships CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS organizations CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS users CASCADE');
  }
}
