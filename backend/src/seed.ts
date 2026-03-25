/**
 * Database seed — run with `tsx src/seed.ts` locally or `node dist/seed.js` in Docker.
 * Creates the initial admin user if one does not already exist.
 */
import { PrismaClient } from '@prisma/client';
import { hash as bcryptHash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    const passwordHash = await bcryptHash(password, 10);
    await prisma.user.create({ data: { username, passwordHash } });
    console.log(`[seed] Created admin user: ${username}`);
  } else {
    console.log(`[seed] Admin user '${username}' already exists — skipping.`);
  }
}

main()
  .catch((e) => {
    console.error('[seed] error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
