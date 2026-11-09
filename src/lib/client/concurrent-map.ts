// Preserve page order; stop starting work after a failure and drain in-flight
// uploads before the UI permits another attempt.
export async function concurrentMap<T, R>(values: readonly T[], concurrency: number,
  process: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && next < values.length) {
      const index = next++;
      try { results[index] = await process(values[index], index); }
      catch (error) { if (!failed) failure = error; failed = true; }
    }
  };
  await Promise.all(Array.from({length: Math.min(values.length, Math.max(1, concurrency))}, worker));
  if (failed) throw failure;
  return results;
}
