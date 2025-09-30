BEGIN;

-- Change room_key from UUID to VARCHAR(120) to match subdomain type
ALTER TABLE organizations ALTER COLUMN room_key TYPE VARCHAR(120);

-- Update the default value to use subdomain instead of UUID
ALTER TABLE organizations ALTER COLUMN room_key SET DEFAULT NULL;

COMMIT;
