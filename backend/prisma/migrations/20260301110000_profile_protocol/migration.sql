-- AlterTable: add protocol column (default 'ssh' for any existing rows)
ALTER TABLE "profiles" ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'ssh';
