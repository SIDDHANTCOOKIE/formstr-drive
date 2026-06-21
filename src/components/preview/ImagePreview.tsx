

interface ImagePreviewProps {
  blobUrl: string;
  name: string;
}

export function ImagePreview({ blobUrl, name }: ImagePreviewProps) {
  return <img src={blobUrl} alt={name} className="preview-media-image" />;
}
