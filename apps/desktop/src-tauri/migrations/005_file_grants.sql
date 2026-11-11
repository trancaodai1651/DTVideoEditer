ALTER TABLE folder_grants
    ADD COLUMN file_only INTEGER NOT NULL DEFAULT 0 CHECK (file_only IN (0, 1));
