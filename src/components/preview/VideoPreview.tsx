

interface VideoPreviewProps {
  blobUrl: string;
}

export function VideoPreview({ blobUrl }: VideoPreviewProps) {
  return (
    <video src={blobUrl} className="preview-media-video" controls playsInline>
      Your browser does not support this video format.
    </video>
  );
}
