import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Open = (src: string, alt?: string) => void;
const LightboxContext = createContext<Open>(() => {});

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const open = useCallback<Open>((src, alt = "") => setImage({ src, alt }), []);

  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setImage(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [image]);

  return (
    <LightboxContext.Provider value={open}>
      {children}
      {image && (
        <div className="lightbox open" role="dialog" aria-label="Изображение крупно" onClick={() => setImage(null)}>
          <img src={image.src} alt={image.alt} />
        </div>
      )}
    </LightboxContext.Provider>
  );
}

export const useLightbox = () => useContext(LightboxContext);
