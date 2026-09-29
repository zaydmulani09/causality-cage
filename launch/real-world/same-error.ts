// Fails only on the error reported in the issue, not on any uncaught error.
export default async function oracle({ pageErrors }: { pageErrors: string[] }) {
  const hit = pageErrors.find((e) => e.includes("reading 'tags'"));
  return hit ? { failed: true, reason: hit } : { failed: false };
}
