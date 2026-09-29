'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { tr } from '@/i18n';

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  stickyLastColumn?: boolean;
  stickyFirstColumn?: boolean;
  compact?: boolean;
}

// Shared DataTable used across every module's list view (Leads, Customers,
// and every future module). Wraps TanStack Table with a consistent
// navy-header / gold-accent style and a built-in skeleton loading state.
export function DataTable<TData>({
  columns,
  data,
  isLoading,
  onRowClick,
  emptyMessage = 'No records found.',
  stickyLastColumn,
  stickyFirstColumn,
  compact,
}: DataTableProps<TData>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const drag = useRef({ down: false, x: 0, left: 0, moved: false });

  // Mouse users cannot two-finger swipe: keep a scrollbar and arrows always in view, and let them drag the table sideways.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => { setScrollWidth(el.scrollWidth); setOverflowing(el.scrollWidth > el.clientWidth + 2); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  });

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border p-4">
        <TableSkeleton cols={columns.length} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      {overflowing && (
        <div className="sticky top-0 z-20 flex items-center gap-1 rounded-t-lg border-b border-border bg-card px-1.5 py-1">
          <button type="button" aria-label={tr("Scroll left")} onClick={() => scrollRef.current?.scrollBy({ left: -400, behavior: 'smooth' })} className="rounded-md p-1 text-navy hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
          <div ref={topRef} className="theme-scroll min-w-0 flex-1 overflow-x-auto" onScroll={(e) => { if (scrollRef.current && scrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) scrollRef.current.scrollLeft = e.currentTarget.scrollLeft; }}><div style={{ width: scrollWidth, height: 1 }} /></div>
          <button type="button" aria-label={tr("Scroll right")} onClick={() => scrollRef.current?.scrollBy({ left: 400, behavior: 'smooth' })} className="rounded-md p-1 text-navy hover:bg-muted"><ChevronRight className="h-5 w-5" /></button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="theme-scroll overflow-x-auto"
        onScroll={(e) => { if (topRef.current && topRef.current.scrollLeft !== e.currentTarget.scrollLeft) topRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
        onMouseDown={(e) => { const el = scrollRef.current; if (!el || (e.target as HTMLElement).closest('button,a,input,select,textarea')) return; drag.current = { down: true, x: e.clientX, left: el.scrollLeft, moved: false }; }}
        onMouseMove={(e) => { const d = drag.current; const el = scrollRef.current; if (!d.down || !el) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 4) d.moved = true; if (d.moved) el.scrollLeft = d.left - dx; }}
        onMouseUp={() => { drag.current.down = false; }}
        onMouseLeave={() => { drag.current.down = false; }}
        onClickCapture={(e) => { if (drag.current.moved) { e.stopPropagation(); e.preventDefault(); drag.current.moved = false; } }}
      >
      <table className="w-full text-sm">
        <thead className="bg-gold text-white">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header, index) => (
                <th key={header.id} className={cn(compact ? 'whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide' : 'px-4 py-3 text-left font-medium', stickyLastColumn && index === headerGroup.headers.length - 1 && 'md:sticky md:right-0 md:z-10 bg-gold shadow-[-8px_0_8px_-6px_rgba(0,0,0,.35)]', stickyFirstColumn && index === 0 && 'sticky left-0 z-10 bg-gold shadow-[8px_0_8px_-6px_rgba(0,0,0,.35)]')}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(typeof header.column.columnDef.header === 'string' ? tr(header.column.columnDef.header) : header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                {tr(emptyMessage)}
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className={cn(
                'border-t border-border transition-colors hover:bg-gold-50 dark:hover:bg-gold-800',
                onRowClick && 'cursor-pointer',
              )}
            >
              {row.getVisibleCells().map((cell, index, cells) => (
                <td key={cell.id} className={cn(compact ? 'px-3 py-1.5' : 'px-4 py-3', stickyLastColumn && index === cells.length - 1 && 'md:sticky md:right-0 md:z-[5] bg-card shadow-[-8px_0_8px_-6px_rgba(0,0,0,.15)]', stickyFirstColumn && index === 0 && 'sticky left-0 z-[5] bg-card shadow-[8px_0_8px_-6px_rgba(0,0,0,.1)]')}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
