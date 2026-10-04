import type { JobPublisher } from "@rakazo/adapter-kit";
import { radarCycleJob } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";

/**
 * Auxiliary reconciler for the elected job reconciler: queues a cycle for every enabled
 * owner whose next cycle is due and whose lease is free. Cycles run as background jobs, so
 * Radar never takes the conversation's run slot or blocks the reconciler.
 */
export async function reconcileRadar(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  now = new Date(),
) {
  const enabled = { settings: { path: ["enabled"], equals: true } } as const;
  // An enabled profile without a schedule (turned on before the scheduler existed) gets one.
  await deps.prisma.radarProfile.updateMany({
    where: { ...enabled, nextCycleAt: null, leaseOwner: null },
    data: { nextCycleAt: now },
  });
  const due = await deps.prisma.radarProfile.findMany({
    where: {
      ...enabled,
      nextCycleAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { nextCycleAt: "asc" },
    take: 50,
    select: { spaceId: true, userId: true },
  });
  for (const owner of due) await deps.jobs.enqueue(radarCycleJob(owner));
  return due.length;
}
