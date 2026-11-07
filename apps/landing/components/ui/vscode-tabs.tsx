import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const VscodeTabs = TabsPrimitive.Root;

const VscodeTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-start rounded-none bg-transparent p-0 text-muted-foreground w-full',
      className
    )}
    {...props}
  />
));
VscodeTabsList.displayName = TabsPrimitive.List.displayName;

const VscodeTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      'rounded-none border-b-2 border-b-transparent',
      'cursor-pointer hover:bg-muted/50',
      'data-[state=active]:bg-muted/50 data-[state=active]:text-foreground data-[state=active]:border-b-primary',
      className
    )}
    {...props}
  />
));
VscodeTabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const VscodeTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-0 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-transparent', className)}
    {...props}
  />
));
VscodeTabsContent.displayName = TabsPrimitive.Content.displayName;

export { VscodeTabs, VscodeTabsList, VscodeTabsTrigger, VscodeTabsContent };
