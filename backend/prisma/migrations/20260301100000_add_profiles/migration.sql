-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "encryptedPassword" TEXT,
    "privateKey" TEXT,
    "domain" TEXT,
    "clipboardEnabled" BOOLEAN,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (profiles → users)
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (connections: add profileId)
ALTER TABLE "connections" ADD COLUMN "profileId" TEXT;

-- AddForeignKey (connections → profiles)
ALTER TABLE "connections" ADD CONSTRAINT "connections_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
