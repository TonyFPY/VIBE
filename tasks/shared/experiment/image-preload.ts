const imagePromises = new Map<string, Promise<void>>();

export function preloadImage(source: string): Promise<void> {
  const cached = imagePromises.get(source);
  if (cached) return cached;

  let image: HTMLImageElement | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    image = new Image();
    let decoding = false;
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      imagePromises.delete(source);
      reject(new Error(`Unable to load image: ${source}`));
    };
    const finish = () => {
      if (settled || decoding) return;
      decoding = true;
      const decode = typeof image?.decode === "function" ? image.decode() : Promise.resolve();
      decode.then(() => {
        if (settled) return;
        settled = true;
        if (image) {
          image.onload = null;
          image.onerror = null;
          image = undefined;
        }
        resolve();
      }, fail);
    };

    image.onload = finish;
    image.onerror = fail;
    image.src = source;
    if (image.complete && image.naturalWidth > 0) finish();
  });

  imagePromises.set(source, promise);
  return promise;
}
