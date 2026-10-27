import React from 'react';
import { FileSpreadsheet, LogOut, Users } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { canRoleAccessWorkspaceTab } from '../../types/roles';
import { NAV_ITEMS } from './nav';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';

/** ⌘K / Ctrl+K: jump to any page, order or customer the role can open. */
export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (tabId: string, orderId?: string) => void;
}) {
  const { currentUser, salesOrders, customers, logoutUser } = useRtdb();
  const can = (id: string) => canRoleAccessWorkspaceTab(currentUser.role, id, currentUser.accountStatus);

  const go = (tabId: string, orderId?: string) => {
    onOpenChange(false);
    onNavigate(tabId, orderId);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, job numbers, POs, customers…" />
      <CommandList>
        <CommandEmpty>No results. Try a job number, PO or customer name.</CommandEmpty>

        <CommandGroup heading="Pages">
          {NAV_ITEMS.filter((i) => can(i.id)).map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem key={item.id} value={`${item.label} ${item.keywords || ''} ${item.description}`} onSelect={() => go(item.id)}>
                <Icon />
                <span className="font-medium">{item.label}</span>
                <span className="truncate text-xs text-muted-foreground">{item.description}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {can('order_journey') && salesOrders.length > 0 && (
          <CommandGroup heading="Orders">
            {salesOrders.slice(0, 200).map((o) => (
              <CommandItem
                key={o.id}
                value={`order ${o.jobNumber} ${o.poNumber} ${o.customerName} ${o.id}`}
                onSelect={() => go('order_journey', o.id)}
              >
                <FileSpreadsheet />
                <span className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold">{o.jobNumber || o.id}</span>
                <span className="truncate">{o.customerName}</span>
                <CommandShortcut>{o.poNumber}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {can('customers') && customers.length > 0 && (
          <CommandGroup heading="Customers">
            {customers.slice(0, 100).map((c) => (
              <CommandItem key={c.id} value={`customer ${c.name} ${c.code} ${c.location || ''} ${c.id}`} onSelect={() => go('customers')}>
                <Users />
                <span className="truncate">{c.name}</span>
                {c.location && <CommandShortcut>{c.location}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Account">
          <CommandItem value="sign out logout" onSelect={() => { onOpenChange(false); logoutUser(); }}>
            <LogOut />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
