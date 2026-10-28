import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type Open = (src: string, alt?: string) => void;
const LightboxContext = createContext<Open>(() => {});

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const open = useCallback<Open>((src, alt = "") => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setImage({ src, alt });
  }, []);

  useEffect(() => {
    if (!image) return;
    const previous = previousFocus.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [image]);

  return (
    <LightboxContext.Provider value={open}>
      {children}
      {image && (
        <dialog ref={dialog} className="lightbox open" aria-label="Изображение крупно" onCancel={() => setImage(null)} onClick={() => setImage(null)}>
          <button type="button" className="btn lightbox-close" autoFocus onClick={() => setImage(null)}><Icon name="close" />Закрыть</button>
          <img src={image.src} alt={image.alt} onClick={(event) => event.stopPropagation()} />
        </dialog>
      )}
    </LightboxContext.Provider>
  );
}

export const useLightbox = () => useContext(LightboxContext);
