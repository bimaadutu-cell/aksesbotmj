"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { IconTelegram } from "@/components/icons";

export default function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const letters = "AKSESBOTMU".split("");

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 2400);
    const t2 = setTimeout(onDone, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <AnimatePresence>
      {!leaving && (
        <motion.div
          key="splash"
          exit={{ opacity: 0, scale: 1.04, filter: "blur(6px)" }}
          transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
          className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center bg-black"
          onClick={() => { setLeaving(true); setTimeout(onDone, 250); }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg,#fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            animation: "gridMove 20s linear infinite",
          }} />
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(700px 400px at 50% 45%, rgba(255,255,255,0.09), transparent 65%)" }} />

          <motion.div
            initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/5 text-white backdrop-blur"
            style={{ boxShadow: "0 0 40px -8px rgba(255,255,255,0.5)" }}
          >
            <IconTelegram size={34} />
          </motion.div>

          <div className="glitch relative font-mono2 text-4xl font-bold tracking-[0.35em] text-white text-glow sm:text-6xl" data-text="AKSESBOTMU">
            {letters.map((l, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 26, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.25 + i * 0.07, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                className="inline-block"
              >
                {l}
              </motion.span>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.25, duration: 0.6 }}
            className="mt-5 font-mono2 text-[12px] uppercase tracking-[0.3em] text-white/50"
          >
            Developed by <span className="text-white/90">Bimz Official</span>
          </motion.p>

          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.4, duration: 1.9, ease: "easeInOut" }} className="mt-8 h-[2px] w-56 origin-left bg-white/80" style={{ boxShadow: "0 0 12px rgba(255,255,255,0.8)" }} />

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} transition={{ delay: 1.6 }} className="blink mt-4 font-mono2 text-[10px] uppercase tracking-[0.4em] text-white/40">
            Initializing secure link…
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
