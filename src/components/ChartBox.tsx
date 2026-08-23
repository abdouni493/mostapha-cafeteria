import React, { ReactElement, useEffect, useRef, useState } from 'react';
import { ResponsiveContainer } from 'recharts';

interface ChartBoxProps {
  /** Chart height in pixels. */
  height: number;
  /** A single recharts chart element (AreaChart, BarChart, PieChart, ...). */
  children: ReactElement;
  className?: string;
  /**
   * Titre du graphique. Quand il est fourni, le graphique est rendu DANS une
   * carte titree : un graphique sans titre oblige a deviner ce qu'il mesure, et
   * repeter la meme carte a chaque appel finissait par produire cinq entetes
   * legerement differents.
   */
  title?: string;
  subtitle?: string;
  /** Contenu libre a droite du titre (filtre, legende, bouton). */
  right?: React.ReactNode;
}

/**
 * Renders a recharts chart only once its box has a real width.
 *
 * `<ResponsiveContainer>` starts out at width/height -1 and logs
 *   "The width(-1) and height(-1) of chart should be greater than 0…"
 * until its ResizeObserver reports a size. On a slower machine — or in a panel
 * that mounts before layout settles — that first frame is what floods the
 * console. Measuring the box here first silences the warning and stops a chart
 * from ever laying itself out inside a zero-sized container.
 */
export default function ChartBox({ height, children, className, title, subtitle, right }: ChartBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Same value → React bails out, so this does not loop on every observation.
    const measure = () => setWidth(el.clientWidth);
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chart = (
    <div ref={ref} className={title ? undefined : className} style={{ height, width: '100%' }}>
      {width > 0 && (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );

  if (!title) return chart;

  return (
    <section className={`card-glass p-4 ${className || ''}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-[#7A6A5C]">{title}</h3>
          {subtitle && <p className="text-[10.5px] text-[#A39588] mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {chart}
    </section>
  );
}
