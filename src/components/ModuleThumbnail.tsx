import { useState } from "react";

interface ModuleThumbnailProps {
  src?: string;
  name: string;
  /**
   * Extra class for placement, e.g. on device cards.
   */
  className?: string;
}

/**
 * Displays a module or device thumbnail.
 *
 * Renders nothing when no image is set or it fails to load, so the layout
 * closes the gap instead of showing a placeholder.
 */
export function ModuleThumbnail({ src, name, className }: ModuleThumbnailProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!src || imageFailed) {
    return null;
  }

  return (
    <img
      className={["module-thumbnail", className].filter(Boolean).join(" ")}
      src={src}
      alt={`${name} thumbnail`}
      draggable={false}
      onError={() => setImageFailed(true)}
    />
  );
}
