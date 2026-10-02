import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import { choiceItemClass, choicePopupClass } from "./choice-styles"
import { SelectionCheckIcon } from "./selection-check-icon"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 10,
  positionerClassName,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string
  }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className={cn("isolate z-50 outline-none", positionerClassName)}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={16}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(choicePopupClass, "z-50 max-h-(--available-height) w-max min-w-[min(14rem,calc(100vw-2rem))] max-w-[min(28rem,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto p-1.5", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-1.5 text-start text-sm font-medium text-muted-foreground data-inset:pl-[34px]",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        choiceItemClass,
        "group/dropdown-menu-item relative mb-(--oa-row-gap) last:mb-0 [overflow-wrap:anywhere] outline-hidden focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-[34px] data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  icon,
  detail,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
  icon?: React.ReactNode
  detail?: React.ReactNode
}) {
  const hasDetail = detail !== undefined
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        choiceItemClass,
        "mb-(--oa-row-gap) last:mb-0 [overflow-wrap:anywhere] outline-hidden focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-[34px] data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        hasDetail && "grid min-h-(--oa-control-height) grid-cols-[1rem_minmax(0,0.8fr)_minmax(0,1.4fr)_1rem] py-2",
        className
      )}
      {...props}
    >
      {hasDetail ? <>
        <span data-slot="dropdown-menu-item-icon" aria-hidden className="flex size-4 items-center justify-center">{icon}</span>
        <span data-slot="dropdown-menu-item-label" className="min-w-0 text-start [overflow-wrap:anywhere]">{children}</span>
        <span data-slot="dropdown-menu-item-detail" className="min-w-0 truncate text-start text-muted-foreground"
          title={typeof detail === "string" || typeof detail === "number" ? String(detail) : undefined}>{detail}</span>
      </> : children}
      <ChevronRightIcon aria-hidden className={cn("size-4 shrink-0", hasDetail ? "justify-self-end" : "ml-auto")} />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -6,
  side = "right",
  sideOffset = 15,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("shadow-lg", className )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        choiceItemClass,
        "relative mb-(--oa-row-gap) last:mb-0 [overflow-wrap:anywhere] pr-9 outline-hidden focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-[34px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-3 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <SelectionCheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        choiceItemClass,
        "relative mb-(--oa-row-gap) last:mb-0 [overflow-wrap:anywhere] pr-9 outline-hidden focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-[34px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-3 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <SelectionCheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-3 my-1.5 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto pl-4 text-xs tabular-nums text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
