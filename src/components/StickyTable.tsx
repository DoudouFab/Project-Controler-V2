import React, { useEffect, useRef } from 'react';

interface StickyTableProps {
  children: React.ReactNode;
  className?: string;
  topOffset?: number;
}

/**
 * Conteneur de tableau compatible scroll horizontal (overflow-x-auto)
 * dont l'en-tête <thead> reste figé en haut d'écran pendant le défilement de la page.
 */
export const StickyTable: React.FC<StickyTableProps> = ({
  children,
  className = '',
  topOffset = 0,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let rafId: number | null = null;

    const applySticky = () => {
      rafId = null;
      const table = wrap.querySelector(':scope > table') as HTMLTableElement | null;
      const thead = table?.querySelector(':scope > thead') as HTMLTableSectionElement | null;
      if (!table || !thead) return;

      if (window.matchMedia && window.matchMedia('print').matches) {
        thead.style.transform = '';
        thead.style.boxShadow = '';
        return;
      }

      const tfoot = table.querySelector(':scope > tfoot') as HTMLTableSectionElement | null;
      const tableRect = table.getBoundingClientRect();
      const theadHeight = thead.getBoundingClientRect().height || thead.offsetHeight;
      const tfootHeight = tfoot ? tfoot.getBoundingClientRect().height || tfoot.offsetHeight : 0;

      const maxOffset = Math.max(0, tableRect.height - theadHeight - tfootHeight - 2);
      const rawOffset = topOffset - tableRect.top;
      const offset = rawOffset > 0 ? Math.min(rawOffset, maxOffset) : 0;

      thead.style.position = 'relative';
      thead.style.zIndex = '20';
      if (offset > 0.5) {
        thead.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
        thead.style.boxShadow =
          '0 1px 0 0 rgba(148, 163, 184, 0.45), 0 4px 10px -2px rgba(15, 23, 42, 0.18)';
      } else {
        thead.style.transform = '';
        thead.style.boxShadow = '';
      }
    };

    const resetForPrint = () => {
      const table = wrap.querySelector(':scope > table') as HTMLTableElement | null;
      const thead = table?.querySelector(':scope > thead') as HTMLTableSectionElement | null;
      if (thead) {
        thead.style.transform = '';
        thead.style.boxShadow = '';
      }
    };

    const schedule = () => {
      if (rafId === null) {
        rafId = window.requestAnimationFrame(applySticky);
      }
    };

    applySticky();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('beforeprint', resetForPrint);
    window.addEventListener('afterprint', schedule);

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(wrap);
    const tableEl = wrap.querySelector(':scope > table');
    if (tableEl && ro) ro.observe(tableEl);

    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(schedule)
        : null;
    mo?.observe(wrap, { childList: true, subtree: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('beforeprint', resetForPrint);
      window.removeEventListener('afterprint', schedule);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [topOffset]);

  return (
    <div ref={wrapRef} className={`sticky-table-wrap overflow-x-auto ${className}`}>
      {children}
    </div>
  );
};
