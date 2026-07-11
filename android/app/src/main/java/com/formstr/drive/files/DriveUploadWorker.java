package com.formstr.drive.files;

import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Pure network orchestrator for a single upload: PUTs each pre-encrypted,
 * pre-hashed blob (chunks + optional preview) to the Blossom server using a
 * pre-signed auth header, then publishes the pre-signed metadata event. No
 * crypto and no Nostr signer here — everything it touches was already
 * produced/signed in the foreground before this worker started, so it can
 * safely run after the app closes.
 */
public final class DriveUploadWorker {
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_BACKOFF_MS = 3000;
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 60000;
    private static final int BUFFER_SIZE = 65536;

    public static final class Blob {
        public final String path;
        public final String hash;
        public final String contentType;

        public Blob(String path, String hash, String contentType) {
            this.path = path;
            this.hash = hash;
            this.contentType = contentType;
        }
    }

    public interface Listener {
        void onProgress(int percent);
        void onComplete();
        void onError(String message);
        void onCancelled();
    }

    private interface ProgressCallback {
        void onProgress(int percent);
    }

    private static final class CancelledException extends RuntimeException {
    }

    private final String server;
    private final List<Blob> blobs;
    private final String authHeader;
    private final String metadataEventJson;
    @Nullable
    private final String metadataEventId;
    private final List<String> relays;
    private final AtomicBoolean cancelled;
    private final Listener listener;

    public DriveUploadWorker(
            String server,
            List<Blob> blobs,
            String authHeader,
            String metadataEventJson,
            List<String> relays,
            AtomicBoolean cancelled,
            Listener listener
    ) {
        this.server = server.endsWith("/") ? server.substring(0, server.length() - 1) : server;
        this.blobs = blobs;
        this.authHeader = authHeader;
        this.metadataEventJson = metadataEventJson;
        this.metadataEventId = NostrRelayPublisher.extractEventId(metadataEventJson);
        this.relays = relays;
        this.cancelled = cancelled;
        this.listener = listener;
    }

    public void run() {
        try {
            int totalBlobs = blobs.size();
            for (int i = 0; i < totalBlobs; i++) {
                if (cancelled.get()) {
                    listener.onCancelled();
                    return;
                }
                Blob blob = blobs.get(i);
                int blobIndex = i;
                uploadBlobWithRetry(blob, (percent) -> {
                    int overall = (blobIndex * 100 + percent) / totalBlobs;
                    listener.onProgress(overall);
                });
            }

            if (cancelled.get()) {
                listener.onCancelled();
                return;
            }

            boolean published = NostrRelayPublisher.publishWithRetry(relays, metadataEventId, metadataEventJson);
            if (!published) {
                listener.onError("Failed to publish file metadata to any relay");
                return;
            }

            listener.onComplete();
        } catch (CancelledException e) {
            listener.onCancelled();
        } catch (Exception e) {
            listener.onError(e.getMessage() != null ? e.getMessage() : "Upload failed");
        } finally {
            cleanupStagedFiles();
        }
    }

    private void uploadBlobWithRetry(Blob blob, ProgressCallback onProgress) throws IOException {
        int retries = MAX_RETRIES;
        IOException lastError = null;

        while (retries > 0) {
            if (cancelled.get()) throw new CancelledException();
            try {
                putBlob(blob, onProgress);
                return;
            } catch (IOException error) {
                lastError = error;
                retries--;
                if (retries > 0 && !cancelled.get()) {
                    try {
                        Thread.sleep(RETRY_BACKOFF_MS);
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }

        throw lastError != null ? lastError : new IOException("Upload failed");
    }

    private void putBlob(Blob blob, ProgressCallback onProgress) throws IOException {
        File file = new File(blob.path);
        long length = file.length();
        URL url = new URL(server + "/upload");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("PUT");
        connection.setDoOutput(true);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setFixedLengthStreamingMode(length);
        connection.setRequestProperty("Authorization", authHeader);
        connection.setRequestProperty("Content-Type", blob.contentType);
        connection.setRequestProperty("X-SHA-256", blob.hash);

        try {
            try (OutputStream out = connection.getOutputStream();
                 InputStream in = new FileInputStream(file)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                long sent = 0;
                int bytesRead;
                while ((bytesRead = in.read(buffer)) != -1) {
                    if (cancelled.get()) throw new CancelledException();
                    out.write(buffer, 0, bytesRead);
                    sent += bytesRead;
                    if (length > 0) {
                        onProgress.onProgress((int) (sent * 100 / length));
                    }
                }
            }

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                String reason = connection.getHeaderField("X-Reason");
                throw new IOException("Server rejected upload with HTTP " + responseCode
                        + (reason != null ? ": " + reason : ""));
            }
        } finally {
            connection.disconnect();
        }
    }

    private void cleanupStagedFiles() {
        File parent = null;
        for (Blob blob : blobs) {
            try {
                File file = new File(blob.path);
                parent = file.getParentFile();
                if (file.exists()) {
                    file.delete();
                }
            } catch (Exception ignored) {
                // best-effort cleanup
            }
        }
        if (parent != null) {
            parent.delete();
        }
    }
}
