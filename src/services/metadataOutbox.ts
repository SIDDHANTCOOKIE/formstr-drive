import { dataLayer, type PublishResult } from "@formstr/local-relay";
import type { Event } from "nostr-tools";
import { signerManager } from "../signer/manager";
import { getStoredItem, setStoredItem, removeStoredItem, STORAGE_KEYS } from "../utils/persistence";

// The @formstr/local-relay worker already retries `timeout`/`failed` relay
// outcomes durably across restarts (its own DeliveryOutbox). This module only
// covers what that layer cannot: (a) `saveFileMetadata` signing a metadata
// event but the app being killed before `publishEvent` is ever called, and
// (b) every relay answering `rejected` — which the worker's outbox does NOT
// retry (verified against the installed build: only timeout/failed are
// retried). A relay's rate limiter answers `rejected`, so without this, a
// rate-limited metadata write vanishes silently.

interface OutboxEntry {
  event: Event;
  coord: string; // `${kind}:${pubkey}:${d}` — dedup key
  queuedAt: number;
  attempts: number;
  lastError?: string;
  label?: string;
}

const MAX_ENTRIES = 200;
const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IO_TIMEOUT_MS = 3000;
const RATE_LIMIT_RE = /rate.?limit/i;
const DUPLICATE_RE = /duplicate/i;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function coordFor(event: Event): string {
  const dTag = event.tags.find((t) => t[0] === "d");
  return `${event.kind}:${event.pubkey}:${dTag?.[1] ?? event.id}`;
}

// Namespaced by the currently signed-in identity, matching the pattern used
// for the Drive Key caches — an account switch on a shared device must never
// see (or drain) another account's queued writes.
function storageKeyOwner(): string | undefined {
  return signerManager.getPubkey();
}

async function loadEntries(owner: string): Promise<OutboxEntry[]> {
  const stored = await withTimeout(
    getStoredItem<unknown>(STORAGE_KEYS.METADATA_OUTBOX, null),
    IO_TIMEOUT_MS,
    null,
  );

  if (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored) &&
    (stored as { pubkey?: string }).pubkey === owner &&
    Array.isArray((stored as { entries?: unknown }).entries)
  ) {
    return (stored as { entries: OutboxEntry[] }).entries;
  }
  return [];
}

async function persistEntries(owner: string, entries: OutboxEntry[]): Promise<void> {
  try {
    await withTimeout(
      setStoredItem(STORAGE_KEYS.METADATA_OUTBOX, { pubkey: owner, entries }),
      IO_TIMEOUT_MS,
      undefined,
    );
  } catch (e) {
    console.warn("[MetadataOutbox] Failed to persist outbox", e);
  }
}

// Serialize all read-modify-write access to the persisted list: uploads are
// serialized upstream (CONCURRENCY.upload = 1) but deleteFiles/moveFiles loops
// are not, and Preferences reads/writes are async.
let ioChain: Promise<void> = Promise.resolve();
function withIoLock<T>(work: () => Promise<T>): Promise<T> {
  const result = ioChain.then(work);
  ioChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function pruneStale(entries: OutboxEntry[]): OutboxEntry[] {
  const cutoff = Date.now() - ENTRY_TTL_MS;
  const fresh = entries.filter((e) => e.queuedAt >= cutoff);
  return fresh.length > MAX_ENTRIES ? fresh.slice(fresh.length - MAX_ENTRIES) : fresh;
}

/** Queue a signed event for durable, at-least-once publishing. Safe to call
 *  even if `publishAndDequeue` is about to be attempted immediately after —
 *  a successful immediate publish just removes the entry right away. */
export async function enqueueMetadataEvent(event: Event, label?: string): Promise<void> {
  const owner = storageKeyOwner();
  if (!owner) return;

  await withIoLock(async () => {
    const entries = pruneStale(await loadEntries(owner));
    const coord = coordFor(event);
    const existingIdx = entries.findIndex((e) => e.coord === coord);

    if (existingIdx !== -1) {
      // Keep whichever version is newer; drop the stale one.
      if (entries[existingIdx].event.created_at >= event.created_at) return;
      entries.splice(existingIdx, 1);
    }

    entries.push({ event, coord, queuedAt: Date.now(), attempts: 0, label });
    await persistEntries(owner, entries);
  });
}

async function removeByCoord(owner: string, coord: string): Promise<void> {
  await withIoLock(async () => {
    const entries = await loadEntries(owner);
    const next = entries.filter((e) => e.coord !== coord);
    if (next.length !== entries.length) await persistEntries(owner, next);
  });
}

function classifyRejection(message: string): { retryable: boolean; benign: boolean } {
  if (DUPLICATE_RE.test(message)) return { retryable: false, benign: true };
  if (RATE_LIMIT_RE.test(message)) return { retryable: true, benign: false };
  return { retryable: false, benign: false };
}

/** Publish a signed event now. Removes it from the outbox on any accepted
 *  result. Throws (without removing) on total failure, so callers that need
 *  to halt a batch (e.g. deleteFiles) still see a rejection — the entry stays
 *  queued for the automatic background drain either way. */
export async function publishAndDequeue(event: Event): Promise<PublishResult> {
  const coord = coordFor(event);
  const owner = storageKeyOwner();

  let result: PublishResult;
  try {
    result = await dataLayer.publishEvent(event);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }

  if (result.ok) {
    if (owner) void removeByCoord(owner, coord);
    return result;
  }

  // Every relay rejected/timed-out/failed for this attempt. If every outcome
  // is a benign duplicate, treat it as success (the event is already stored).
  const allBenignDuplicate = result.relayResults.every(
    (r) => r.status === "rejected" && DUPLICATE_RE.test(r.message ?? ""),
  );
  if (allBenignDuplicate) {
    if (owner) void removeByCoord(owner, coord);
    return result;
  }

  const reasons = result.relayResults
    .map((r) => `${r.relay}: ${r.status}${r.message ? ` (${r.message})` : ""}`)
    .join(", ");
  throw new Error(`No relay accepted the metadata event — ${reasons}`);
}

/** Best-effort drain of every queued entry, paced to avoid the rate limiting
 *  observed under burst publishing (~90% rejected at 10/s on damus.io; a
 *  fresh key's single publish is unaffected, so ~1/s is a safe, conservative
 *  pace for bulk draining). Never throws. */
export async function drainMetadataOutbox(): Promise<{ published: number; remaining: number }> {
  const owner = storageKeyOwner();
  if (!owner) return { published: 0, remaining: 0 };

  const entries = pruneStale(await loadEntries(owner));
  let published = 0;
  const stillQueued: OutboxEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const result = await dataLayer.publishEvent(entry.event);

      if (result.ok) {
        published++;
        continue;
      }

      const allBenignDuplicate = result.relayResults.every(
        (r) => r.status === "rejected" && DUPLICATE_RE.test(r.message ?? ""),
      );
      if (allBenignDuplicate) {
        published++;
        continue;
      }

      // Classify by the least-favorable non-benign outcome so a single
      // genuinely-rejected relay doesn't get masked by other relays timing out.
      const nonBenign = result.relayResults.filter(
        (r) => !(r.status === "rejected" && DUPLICATE_RE.test(r.message ?? "")),
      );
      const anyRetryable = nonBenign.some(
        (r) => r.status !== "rejected" || classifyRejection(r.message ?? "").retryable,
      );

      if (anyRetryable) {
        stillQueued.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: nonBenign.find((r) => r.message)?.message ?? "no relay accepted",
        });
      }
      // else: a genuine (non-rate-limit, non-timeout) rejection on every relay
      // — drop it. Retrying a hard rejection (bad signature, blocked pubkey)
      // forever would just waste requests with no chance of success.
    } catch (e) {
      // Network/exception — keep it queued, it's transient.
      stillQueued.push({
        ...entry,
        attempts: entry.attempts + 1,
        lastError: e instanceof Error ? e.message : String(e),
      });
    }

    // Pace bulk draining — see the perf note above.
    if (i < entries.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await withIoLock(async () => {
    // Re-read in case something else (a fresh enqueue) landed mid-drain, and
    // merge rather than blindly overwrite.
    const current = await loadEntries(owner);
    const stillQueuedCoords = new Set(stillQueued.map((e) => e.coord));
    const drainedCoords = new Set(entries.map((e) => e.coord));
    const untouched = current.filter((e) => !drainedCoords.has(e.coord));
    await persistEntries(owner, pruneStale([...untouched, ...stillQueued]));
    void stillQueuedCoords; // (kept for clarity of intent; no-op)
  });

  return { published, remaining: stillQueued.length };
}

export async function getMetadataOutboxSize(): Promise<number> {
  const owner = storageKeyOwner();
  if (!owner) return 0;
  return (await loadEntries(owner)).length;
}

// Clear on logout, matching the Drive Key caches — a queued write must never
// leak across an account switch on a shared device.
let lastKnownOwner: string | undefined;
signerManager.onChange((pubkey) => {
  if (!pubkey && lastKnownOwner) {
    void removeStoredItem(STORAGE_KEYS.METADATA_OUTBOX);
  }
  lastKnownOwner = pubkey ?? undefined;
});
