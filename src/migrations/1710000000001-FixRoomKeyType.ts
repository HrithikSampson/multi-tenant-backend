import { MigrationInterface, QueryRunner } from "typeorm";

export class FixRoomKeyType1710000000001 implements MigrationInterface {
    name = 'FixRoomKeyType1710000000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Change room_key from UUID to VARCHAR(120) to match subdomain type
        await queryRunner.query(`ALTER TABLE organizations ALTER COLUMN room_key TYPE VARCHAR(120)`);
        
        // Update the default value to use subdomain instead of UUID
        await queryRunner.query(`ALTER TABLE organizations ALTER COLUMN room_key SET DEFAULT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert back to UUID type
        await queryRunner.query(`ALTER TABLE organizations ALTER COLUMN room_key TYPE UUID`);
        await queryRunner.query(`ALTER TABLE organizations ALTER COLUMN room_key SET DEFAULT gen_random_uuid()`);
    }
}
