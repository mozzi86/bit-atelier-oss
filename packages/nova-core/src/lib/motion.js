// Zentrale framer-motion-Presets (DESIGN-SPEC: ruhig, kein Bounce, Dauer ≤ 0.4s).

export const fadeInUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: "easeOut" },
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.25, ease: "easeOut" },
};

// Gestaffeltes Einblenden: stagger(i) als transition mit Verzögerung i*0.05s.
export const stagger = (i = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: "easeOut", delay: i * 0.05 },
});

// Dezenter Karten-Hover (Schatten via Klasse hover:shadow-md kombinieren).
export const cardHover = {
  whileHover: { y: -2 },
  transition: { duration: 0.2, ease: "easeOut" },
};
