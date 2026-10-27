import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input } from './input';
import { EmptyState } from './data-display';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide below this breakpoint to keep small screens readable. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Text searched by the search box; omit to hide search. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  initialSort?: { id: string; desc?: boolean };
  className?: string;
}

const hideClass = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Search…',
  toolbar,
  onRowClick,
  pageSize = 25,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  initialSort,
  className,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<{ id: string; desc?: boolean } | undefined>(initialSort);
  const [page, setPage] = React.useState(0);
  const deferredQuery = React.useDeferredValue(query);

  const filtered = React.useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let out = q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
    const col = sort && columns.find((c) => c.id === sort.id);
    if (col?.sortValue) {
      const get = col.sortValue;
      out = [...out].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'en-IN', { numeric: true });
        return sort?.desc ? -cmp : cmp;
      });
    }
    return out;
  }, [rows, deferredQuery, searchText, sort, columns]);

  React.useEffect(() => setPage(0), [deferredQuery, rows.length]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const toggleSort = (id: string) =>
    setSort((prev) => (prev?.id !== id ? { id } : prev.desc ? undefined : { id, desc: true }));

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-card', className)}>
      {(searchText || toolbar) && (
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          {searchText && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {toolbar && <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">{toolbar}</div>}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={query ? 'No matches' : emptyTitle}
          description={query ? `Nothing matches “${query}”. Try a different search.` : emptyDescription}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr>
                {columns.map((c) => {
                  const active = sort?.id === c.id;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={active ? (sort?.desc ? 'descending' : 'ascending') : undefined}
                      className={cn(
                        'whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                        c.align === 'right' && 'text-right',
                        c.align === 'center' && 'text-center',
                        c.hideBelow && hideClass[c.hideBelow]
                      )}
                    >
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.id)}
                          className={cn('inline-flex cursor-pointer items-center gap-1 hover:text-foreground', c.align === 'right' && 'flex-row-reverse')}
                        >
                          {c.header}
                          {active ? sort?.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(
                    'border-t border-border transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none'
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        'px-4 py-3 align-middle',
                        c.align === 'right' && 'text-right tabular-nums',
                        c.align === 'center' && 'text-center',
                        c.hideBelow && hideClass[c.hideBelow],
                        c.className
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > pageSize && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {page * pageSize + 1}–{Math.min(filtered.length, (page + 1) * pageSize)} of {filtered.length}
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages - 1} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
