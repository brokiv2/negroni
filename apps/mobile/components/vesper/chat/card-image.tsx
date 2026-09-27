import type { CardImageRef } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import {
  type ArtifactImageTarget,
  cachedArtifactImage,
  cardImageAspectRatio,
  loadArtifactImage,
} from "../../../lib/vesper/artifact-image";
import { vt } from "../theme";

/**
 * The first inline image in the mobile transcript.
 *
 * The box is reserved from the ref's own width and height before any bytes
 * arrive, so a screenshot landing never reflows the list. While it loads — and
 * whenever there is nothing to load — the placeholder treatment fills the same
 * space: a near-white surface with skeleton bars, not an empty hole.
 */
export function CardImage({
  image,
  target,
  label,
  loading,
}: {
  image?: CardImageRef;
  target: ArtifactImageTarget | null;
  /** Shown over the placeholder when there is no picture. */
  label?: string;
  /** Draw the skeleton bars: the page is still being read. */
  loading?: boolean;
}) {
  const [uri, setUri] = useState<string | undefined>(() =>
    image ? cachedArtifactImage(image.artifactId) : undefined,
  );

  useEffect(() => {
    if (!image || !target || uri) return;
    let cancelled = false;
    void loadArtifactImage(target, image)
      .then((next) => {
        if (!cancelled) setUri(next);
      })
      .catch(() => {
        // A screenshot that will not load is not worth an error row; the card
        // keeps its placeholder and the rest of it still reads.
      });
    return () => {
      cancelled = true;
    };
  }, [image, target, uri]);

  const aspectRatio = image ? cardImageAspectRatio(image) : 1.7;

  if (uri) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri }}
        resizeMode="cover"
        style={{
          width: "100%",
          aspectRatio,
          borderRadius: vt.radius.toolCardInner,
          backgroundColor: vt.extras.previewPlaceholder,
        }}
      />
    );
  }

  return (
    <View
      style={{
        width: "100%",
        aspectRatio,
        borderRadius: vt.radius.toolCardInner,
        backgroundColor: vt.extras.previewPlaceholder,
        padding: 14,
        gap: 8,
        justifyContent: "center",
      }}
    >
      {!!label && (
        <View
          style={{
            height: 10,
            width: "70%",
            borderRadius: 5,
            backgroundColor: vt.extras.skeleton,
          }}
        />
      )}
      {(loading || !label) &&
        ["90%", "75%", "55%"].map((width) => (
          <View
            key={width}
            style={{
              height: 8,
              width: width as `${number}%`,
              borderRadius: 4,
              backgroundColor: vt.extras.skeleton,
            }}
          />
        ))}
    </View>
  );
}
