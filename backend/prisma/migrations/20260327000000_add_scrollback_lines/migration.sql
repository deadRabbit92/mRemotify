-- Add scrollback lines setting to connections and profiles
ALTER TABLE "connections" ADD COLUMN "scrollbackLines" INTEGER;
ALTER TABLE "profiles" ADD COLUMN "scrollbackLines" INTEGER;
