-- Add SSH and RDP profile inheritance to folders
ALTER TABLE "folders" ADD COLUMN "sshProfileId" TEXT;
ALTER TABLE "folders" ADD COLUMN "rdpProfileId" TEXT;

ALTER TABLE "folders" ADD CONSTRAINT "folders_sshProfileId_fkey" FOREIGN KEY ("sshProfileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_rdpProfileId_fkey" FOREIGN KEY ("rdpProfileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
